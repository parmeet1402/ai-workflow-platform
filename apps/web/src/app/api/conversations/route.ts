import { NextResponse } from "next/server";
import { sumOrgTokensUsed, titleFromQuestion } from "@/lib/chat/persist";
import { createClient } from "@/lib/supabase/server";
import type { ConversationListItem } from "@/types/conversation";

const TITLE_MAX = 200;

/** List the current user's conversations + org-wide token usage. */
export async function GET() {
  try {
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

    const { data: rows, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error listing conversations", error);
      return NextResponse.json(
        { error: "Error listing conversations" },
        { status: 500 },
      );
    }

    const conversations = rows ?? [];
    const ids = conversations.map((c) => c.id as string);

    const lastByConversation = new Map<string, string>();
    if (ids.length > 0) {
      const { data: messageRows, error: messagesError } = await supabase
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false });

      if (messagesError) {
        console.error("Error loading conversation previews", messagesError);
      } else {
        for (const row of messageRows ?? []) {
          const conversationId = row.conversation_id as string;
          if (!lastByConversation.has(conversationId)) {
            lastByConversation.set(conversationId, row.content as string);
          }
        }
      }
    }

    const list: ConversationListItem[] = conversations.map((c) => ({
      id: c.id as string,
      title: c.title as string,
      createdAt: c.created_at as string,
      updatedAt: c.updated_at as string,
      lastMessage: lastByConversation.get(c.id as string) ?? null,
    }));

    let orgTokensUsed = 0;
    try {
      orgTokensUsed = await sumOrgTokensUsed(supabase, organizationId);
    } catch (tokenError) {
      console.error("Error loading org token usage", tokenError);
    }

    return NextResponse.json(
      { conversations: list, orgTokensUsed },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/conversations", error);
    return NextResponse.json(
      { error: "Error listing conversations" },
      { status: 500 },
    );
  }
}

/** Create an empty conversation (optional; /api/chat also auto-creates). */
export async function POST(request: Request) {
  try {
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

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    let title = "New chat";
    if (
      body != null &&
      typeof body === "object" &&
      "title" in body &&
      typeof (body as { title: unknown }).title === "string"
    ) {
      const raw = (body as { title: string }).title.trim();
      if (raw) {
        title = titleFromQuestion(raw.slice(0, TITLE_MAX));
      }
    }

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        organization_id: organizationId,
        user_id: user.id,
        title,
      })
      .select("id, title, created_at, updated_at")
      .single();

    if (error || !data) {
      console.error("Error creating conversation", error);
      return NextResponse.json(
        { error: "Error creating conversation" },
        { status: 500 },
      );
    }

    const conversation: ConversationListItem = {
      id: data.id as string,
      title: data.title as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
      lastMessage: null,
    };

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    console.error("Error in POST /api/conversations", error);
    return NextResponse.json(
      { error: "Error creating conversation" },
      { status: 500 },
    );
  }
}
