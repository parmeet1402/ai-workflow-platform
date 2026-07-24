import { NextResponse } from "next/server";

import {
  buildRagMessages,
  chunksToCitations,
} from "@/lib/chat/prompt";
import {
  createOpenAIClient,
  getChatModel,
} from "@/lib/chat/openai";
import { retrieveRelevantChunks } from "@/lib/chat/retrieval";
import type { ChatUsage } from "@/lib/chat/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_MESSAGE_CONTENT_CHARS = 8_000;
const MAX_MESSAGES = 40;

type IncomingMessage = {
  role?: unknown;
  content?: unknown;
};

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

function validateAndParseAllMessages(body: unknown): { messages: Array<{ role: "user" | "assistant"; content: string }> } | { error: string } {
  if (body == null || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }

  const messagesRaw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return { error: "messages must be a non-empty array" };
  }
  if (messagesRaw.length > MAX_MESSAGES) {
    return { error: `messages must have at most ${MAX_MESSAGES} items` };
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of messagesRaw as IncomingMessage[]) {
    // Loop through each raw message and validate it and output the message in desired format.
    if (item == null || typeof item !== "object") {
      return { error: "Each message must be an object" };
    }
    const role = item.role;
    const content = item.content;
    if (role !== "user" && role !== "assistant") {
      return { error: "Each message role must be user or assistant" };
    }
    if (typeof content !== "string") {
      return { error: "Each message content must be a string" };
    }
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return { error: "Message content must not be empty" };
    }
    if (trimmedContent.length > MAX_MESSAGE_CONTENT_CHARS) {
      return {
        error: `Message content must be at most ${MAX_MESSAGE_CONTENT_CHARS} characters`,
      };
    }
    messages.push({ role, content: trimmedContent });
  }

  return { messages };
}

function getLastUserQuestion(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  return null;
}

/**
 * Non-streaming RAG chat (CP1): auth + org + rate-limit → retrieve → completion.
 * Returns `{ answer, citations, usage }`.
 */
export async function POST(request: Request) {
  // This route is used to chat with the model.
  // Route: High level workflow:
  // 1. Authenticate the user.
  // 2. Check the rate limit.
  // 3. Create Embedding for the user's question.
  // 4. Retrieve the relevant chunks from the database.
  // 5. Generate the chat response using the model.
  // 6. Return the chat response.

  try {  
    const supabase = await createClient();

    // Get the user from the database.
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    // Validate the user.
    if (!user || userError) {
      return jsonError("Unauthorized", 401);
    }

    // Check the rate limit.
    const rateLimit = checkRateLimit(
      `chat:${user.id}`,
      CHAT_RATE_LIMIT,
      CHAT_RATE_WINDOW_MS,
    );
    
    // Validate the rate limit.
    if (!rateLimit.allowed) {
      return jsonError("Too many chat requests. Please slow down.", 429, {
        "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)),
      });
    }

    // find the organization data for the user.
    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    // Check if the organization is found.
    if (membershipError || !membership) {
      return jsonError("Organization not found", 400);
    }

    // Get the organization ID from the organization/memberships table.
    const organizationId = membership.organization_id as string;

    let body: unknown;
    try {
      // Parse the request body.
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    // Takes in raw messages array, validates and returns a structured message {role, content} or array
    const parsedResponse = validateAndParseAllMessages(body);
    if ("error" in parsedResponse) {
      return jsonError(parsedResponse.error, 400);
    }

    const question = getLastUserQuestion(parsedResponse.messages);

    // Check if the user has asked a question.
    if (!question) {
      return jsonError("messages must include at least one user message", 400);
    }

    const openai = createOpenAIClient();
    
    // 1. Question is converted into a vector embedding 
    // 2. The vector embedding is used to retrieve relevant chunks from the database.
    const chunks = await retrieveRelevantChunks({
      organizationId,
      query: question,
      client: openai,
    });

    // Generate the chat response using the model to be sent to the user.
    const completion = await openai.chat.completions.create({
      model: getChatModel(),
      // Returns the system message and the user message.
      // The system message is the system prompt plus the retrieved context (chunks)
      // The user message is the user's question.
      messages: buildRagMessages({ question, chunks }),
      stream: false,
    });

    const answer = completion.choices[0]?.message?.content?.trim() ?? "";
    // Check if the answer is empty.
    if (!answer) {
      return jsonError("Empty completion from model", 502);
    }

    // Get the usage data from the completion.
    const usageRaw = completion.usage;
    // Convert the usage data to the ChatUsage type.
    const usage: ChatUsage = {
      promptTokens: usageRaw?.prompt_tokens ?? 0,
      completionTokens: usageRaw?.completion_tokens ?? 0,
      totalTokens: usageRaw?.total_tokens ?? 0,
    };

    // Return the chat response to the user.
    return NextResponse.json(
      {
        answer,
        citations: chunksToCitations(chunks),
        usage,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Error in POST /api/chat", error);
    const message =
      error instanceof Error ? error.message : "Error generating chat response";
    // Config / missing env should surface as 500 with a stable client message.
    if (
      message.includes("OPENAI_API_KEY") ||
      message.includes("DATABASE_URL")
    ) {
      return jsonError("Chat is not configured", 500);
    }
    return jsonError("Error generating chat response", 500);
  }
}
