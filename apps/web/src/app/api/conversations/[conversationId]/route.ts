import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  ConversationDetail,
  PersistedChatMessage,
} from "@/types/conversation";
import type { ChatCitation, ChatUsage } from "@/lib/chat/types";

type RouteContext = {
  params: Promise<{ conversationId: string }>;
};

function parseCitations(raw: unknown): ChatCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCitation[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const documentId = (item as { documentId?: unknown }).documentId;
    const documentName = (item as { documentName?: unknown }).documentName;
    const page = (item as { page?: unknown }).page;
    if (typeof documentId !== "string" || typeof documentName !== "string") {
      continue;
    }
    out.push({
      documentId,
      documentName,
      page: typeof page === "number" ? page : null,
    });
  }
  return out;
}

function parseUsage(row: {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}): ChatUsage | null {
  if (
    typeof row.prompt_tokens !== "number" &&
    typeof row.completion_tokens !== "number" &&
    typeof row.total_tokens !== "number"
  ) {
    return null;
  }
  const promptTokens = row.prompt_tokens ?? 0;
  const completionTokens = row.completion_tokens ?? 0;
  const totalTokens =
    row.total_tokens ?? promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/** Load one of the current user's conversations with messages. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return NextResponse.json(
        { error: "conversationId is required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!user || userError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 400 },
      );
    }

    const organizationId = membership.organization_id as string;

    const { data: conversation, error: conversationError } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at, organization_id, user_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (conversationError) {
      console.error("Error loading conversation", conversationError);
      return NextResponse.json(
        { error: "Error loading conversation" },
        { status: 500 },
      );
    }

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    if (conversation.organization_id !== organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (conversation.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: messageRows, error: messagesError } = await supabase
      .from("messages")
      .select(
        "id, role, content, citations, prompt_tokens, completion_tokens, total_tokens, created_at",
      )
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error loading messages", messagesError);
      return NextResponse.json(
        { error: "Error loading conversation" },
        { status: 500 },
      );
    }

    const messages: PersistedChatMessage[] = (messageRows ?? []).map((row) => ({
      id: row.id as string,
      role: row.role as "user" | "assistant",
      content: row.content as string,
      citations: parseCitations(row.citations),
      usage: parseUsage(row),
      createdAt: row.created_at as string,
    }));

    const detail: ConversationDetail = {
      id: conversation.id as string,
      title: conversation.title as string,
      createdAt: conversation.created_at as string,
      updatedAt: conversation.updated_at as string,
      messages,
    };

    return NextResponse.json(
      { conversation: detail },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/conversations/[conversationId]", error);
    return NextResponse.json(
      { error: "Error loading conversation" },
      { status: 500 },
    );
  }
}
