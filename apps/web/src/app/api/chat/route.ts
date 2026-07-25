import {
  buildRagMessages,
  chunksToCitations,
} from "@/lib/chat/prompt";
import {
  estimateChatUsage,
  hasProviderUsage,
} from "@/lib/chat/estimate-usage";
import {
  createOpenAIClient,
  getChatModel,
} from "@/lib/chat/openai";
import {
  createConversation,
  deleteLastAssistantMessage,
  getOwnedConversation,
  persistChatTurn,
  titleFromQuestion,
} from "@/lib/chat/persist";
import { retrieveRelevantChunks } from "@/lib/chat/retrieval";
import { formatSseEvent, SSE_HEADERS } from "@/lib/chat/sse";
import type { ChatSseEvent, ChatUsage } from "@/lib/chat/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60_000;
const MAX_MESSAGE_CONTENT_CHARS = 8_000;
const MAX_MESSAGES = 40;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type IncomingMessage = {
  role?: unknown;
  content?: unknown;
};

type ParsedChatBody = {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  conversationId: string | null;
  regenerate: boolean;
};

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return Response.json({ error }, { status, headers });
}

function parseConversationId(raw: unknown): string | null | { error: string } {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return { error: "conversationId must be a valid UUID" };
  }
  return raw;
}

function validateAndParseBody(body: unknown): ParsedChatBody | { error: string } {
  if (body == null || typeof body !== "object") {
    return { error: "Invalid JSON body" };
  }

  const record = body as {
    messages?: unknown;
    conversationId?: unknown;
    regenerate?: unknown;
  };

  const messagesRaw = record.messages;
  if (!Array.isArray(messagesRaw) || messagesRaw.length === 0) {
    return { error: "messages must be a non-empty array" };
  }
  if (messagesRaw.length > MAX_MESSAGES) {
    return { error: `messages must have at most ${MAX_MESSAGES} items` };
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const item of messagesRaw as IncomingMessage[]) {
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

  const conversationId = parseConversationId(record.conversationId);
  if (conversationId && typeof conversationId === "object" && "error" in conversationId) {
    return conversationId;
  }

  const regenerate = record.regenerate === true;
  if (regenerate && !conversationId) {
    return { error: "regenerate requires conversationId" };
  }

  return {
    messages,
    conversationId: conversationId as string | null,
    regenerate,
  };
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

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Streaming RAG chat: auth + org + rate-limit → retrieve → SSE → persist on success.
 * Events: delta, citations, usage, conversation, done | error.
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
    const parsed = validateAndParseBody(body);
    if ("error" in parsed) {
      return jsonError(parsed.error, 400);
    }

    const question = getLastUserQuestion(parsed.messages);

    // Check if the user has asked a question.
    if (!question) {
      return jsonError("messages must include at least one user message", 400);
    }

    let existingTitle: string | null = null;
    if (parsed.conversationId) {
      try {
        const existing = await getOwnedConversation(supabase, {
          conversationId: parsed.conversationId,
          organizationId,
          userId: user.id,
        });
        if (!existing) {
          return jsonError("Conversation not found", 404);
        }
        existingTitle = existing.title;
      } catch (loadError) {
        console.error("Error loading conversation", loadError);
        return jsonError("Failed to load conversation", 500);
      }
    }

    const openai = createOpenAIClient();

    // 1. Question is converted into a vector embedding
    // 2. The vector embedding is used to retrieve relevant chunks from the database.
    const chunks = await retrieveRelevantChunks({
      organizationId,
      query: question,
      client: openai,
    });
    const citations = chunksToCitations(chunks);
    const ragMessages = buildRagMessages({ question, chunks });

    const encoder = new TextEncoder();
    const requestConversationId = parsed.conversationId;
    const requestRegenerate = parsed.regenerate;

    const stream = new ReadableStream<Uint8Array>({
      // controller is used to enqueue the stream of data from the server.
      async start(controller) {
        // enqueue is used to enqueue the stream of data from the server.
        const enqueue = (event: ChatSseEvent) => {
          // encoder.encode is used to encode the stream of data from the server (in string) to bytes.
          // formatSseEvent is used to format the stream of data from the server (in string) to SSE event.
          controller.enqueue(encoder.encode(formatSseEvent(event)));
        };

        try {
          const completion = await openai.chat.completions.create(
            {
              model: getChatModel(),
              messages: ragMessages,
              stream: true,
              stream_options: { include_usage: true },
            },
            { signal: request.signal },
          );

          // sawDelta is used to check if the stream of data from the server has a delta.
          let sawDelta = false;
          let completionText = "";
          // usage is used to store the usage of the stream of data from the server.
          let usage: ChatUsage = {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          };

          for await (const chunk of completion) {
            if (request.signal.aborted) {
              break;
            }

            const text = chunk.choices[0]?.delta?.content;
            if (text) {
              sawDelta = true;
              completionText += text;
              enqueue({ type: "delta", text });
            }

            const usageRaw = chunk.usage;
            if (usageRaw) {
              const promptTokens = usageRaw.prompt_tokens ?? 0;
              const completionTokens = usageRaw.completion_tokens ?? 0;
              usage = {
                promptTokens,
                completionTokens,
                totalTokens:
                  usageRaw.total_tokens ?? promptTokens + completionTokens,
              };
            }
          }

          if (request.signal.aborted) {
            controller.close();
            return;
          }

          if (!sawDelta) {
            enqueue({ type: "error", error: "Empty completion from model" });
            controller.close();
            return;
          }

          if (!hasProviderUsage(usage)) {
            usage = estimateChatUsage({
              promptTexts: ragMessages.map((m) => m.content),
              completionText,
            });
          }

          let conversationId = requestConversationId;
          let conversationTitle =
            existingTitle ?? titleFromQuestion(question);
          let skipUserMessage = false;

          try {
            if (!conversationId) {
              const created = await createConversation(supabase, {
                organizationId,
                userId: user.id,
                title: conversationTitle,
              });
              conversationId = created.id;
              conversationTitle = created.title;
            } else if (requestRegenerate) {
              await deleteLastAssistantMessage(supabase, conversationId);
              skipUserMessage = true;
            }

            await persistChatTurn(supabase, {
              conversationId,
              userContent: question,
              assistantContent: completionText,
              citations,
              usage,
              skipUserMessage,
            });
          } catch (persistError) {
            console.error("Error persisting chat turn", persistError);
            enqueue({
              type: "error",
              error: "Failed to save conversation",
            });
            controller.close();
            return;
          }

          enqueue({ type: "citations", citations });
          enqueue({ type: "usage", usage });
          enqueue({
            type: "conversation",
            conversationId,
            title: conversationTitle,
          });
          enqueue({
            type: "done",
            conversationId,
          });
          controller.close();
        } catch (error) {
          console.error("Error streaming POST /api/chat", error);
          const message =
            error instanceof Error
              ? error.message
              : "Error generating chat response";
          try {
            if (
              message.includes("OPENAI_API_KEY") ||
              message.includes("DATABASE_URL")
            ) {
              enqueue({ type: "error", error: "Chat is not configured" });
            } else {
              enqueue({ type: "error", error: "Error generating chat response" });
            }
          } catch {
            // Controller may already be closed.
          }
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      },
      cancel() {
        // Client disconnected; OpenAI async iterator stops on next chunk check.
      },
    });

    return sseResponse(stream);
  } catch (error) {
    console.error("Error in POST /api/chat", error);
    const message =
      error instanceof Error ? error.message : "Error generating chat response";
    if (
      message.includes("OPENAI_API_KEY") ||
      message.includes("DATABASE_URL")
    ) {
      return jsonError("Chat is not configured", 500);
    }
    return jsonError("Error generating chat response", 500);
  }
}
