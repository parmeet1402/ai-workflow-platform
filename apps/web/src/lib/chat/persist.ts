import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatCitation, ChatUsage } from "@/lib/chat/types";

const TITLE_MAX_CHARS = 80;

export function titleFromQuestion(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (trimmed.length <= TITLE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

type ConversationRow = {
  id: string;
  organization_id: string;
  user_id: string;
  title: string;
};

/**
 * Load a conversation the user owns in the given org, or null.
 */
export async function getOwnedConversation(
  supabase: SupabaseClient,
  {
    conversationId,
    organizationId,
    userId,
  }: {
    conversationId: string;
    organizationId: string;
    userId: string;
  },
): Promise<ConversationRow | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, organization_id, user_id, title")
    .eq("id", conversationId)
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading conversation", error);
    throw new Error("Failed to load conversation");
  }

  return data as ConversationRow | null;
}

export async function createConversation(
  supabase: SupabaseClient,
  {
    organizationId,
    userId,
    title,
  }: {
    organizationId: string;
    userId: string;
    title: string;
  },
): Promise<ConversationRow> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      title,
    })
    .select("id, organization_id, user_id, title")
    .single();

  if (error || !data) {
    console.error("Error creating conversation", error);
    throw new Error("Failed to create conversation");
  }

  return data as ConversationRow;
}

/**
 * Delete the latest assistant message in a conversation (regenerate).
 * Returns the deleted message's total_tokens (0 if none / null).
 */
export async function deleteLastAssistantMessage(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<number> {
  const { data: last, error: loadError } = await supabase
    .from("messages")
    .select("id, role, total_tokens")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (loadError) {
    console.error("Error loading last message for regenerate", loadError);
    throw new Error("Failed to prepare regenerate");
  }

  if (!last || last.role !== "assistant") {
    return 0;
  }

  const { error: deleteError } = await supabase
    .from("messages")
    .delete()
    .eq("id", last.id);

  if (deleteError) {
    console.error("Error deleting assistant message for regenerate", deleteError);
    throw new Error("Failed to prepare regenerate");
  }

  return typeof last.total_tokens === "number" ? last.total_tokens : 0;
}

export async function persistChatTurn(
  supabase: SupabaseClient,
  {
    conversationId,
    userContent,
    assistantContent,
    citations,
    usage,
    skipUserMessage,
  }: {
    conversationId: string;
    userContent: string;
    assistantContent: string;
    citations: ChatCitation[];
    usage: ChatUsage;
    /** When regenerating, the user turn already exists. */
    skipUserMessage: boolean;
  },
): Promise<void> {
  const rows: Array<{
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    citations?: ChatCitation[];
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  }> = [];

  if (!skipUserMessage) {
    rows.push({
      conversation_id: conversationId,
      role: "user",
      content: userContent,
      citations: [],
    });
  }

  rows.push({
    conversation_id: conversationId,
    role: "assistant",
    content: assistantContent,
    citations,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
  });

  const { error: insertError } = await supabase.from("messages").insert(rows);
  if (insertError) {
    console.error("Error persisting chat messages", insertError);
    throw new Error("Failed to persist chat messages");
  }

  const { error: touchError } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (touchError) {
    console.error("Error updating conversation timestamp", touchError);
    // Messages already saved; do not fail the stream over timestamp.
  }
}

/** Sum of assistant total_tokens for all conversations in an organization. */
export async function sumOrgTokensUsed(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<number> {
  const { data: conversations, error: conversationsError } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId);

  if (conversationsError) {
    console.error("Error listing conversations for token sum", conversationsError);
    throw new Error("Failed to load token usage");
  }

  const ids = (conversations ?? []).map((c) => c.id as string);
  if (ids.length === 0) return 0;

  const { data, error } = await supabase
    .from("messages")
    .select("total_tokens")
    .in("conversation_id", ids)
    .eq("role", "assistant")
    .not("total_tokens", "is", null);

  if (error) {
    console.error("Error summing org token usage", error);
    throw new Error("Failed to load token usage");
  }

  return (data ?? []).reduce((sum, row) => {
    const tokens = (row as { total_tokens?: number | null }).total_tokens;
    return sum + (typeof tokens === "number" ? tokens : 0);
  }, 0);
}
