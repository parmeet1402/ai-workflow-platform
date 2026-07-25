"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, MessageSquare, RefreshCw, SendIcon } from "lucide-react";
import { readChatSse } from "@/lib/chat/read-sse";
import type { ChatCitation, ChatUsage } from "@/lib/chat/types";
import { useChatSession } from "./chat-session-context";

const INITIAL_ASSISTANT_ID = "assistant-initial";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  usage?: ChatUsage;
};

type ChatApiError = {
  error: string;
};

function newMessageId(prefix: string) {
  return crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;
}

function toApiMessages(messages: ChatMessage[]) {
  return messages
    .filter((m) => m.id !== INITIAL_ASSISTANT_ID)
    .map(({ role, content }) => ({ role, content }));
}

/** Last turn is a real assistant reply that can be regenerated from its preceding user message. */
function getRegenerateTarget(messages: ChatMessage[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || last.id === INITIAL_ASSISTANT_ID) {
    return null;
  }

  const prior = messages.slice(0, -1);
  const lastUser = [...prior].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;

  return { assistantId: last.id, priorMessages: prior };
}

function citationLabel(citation: ChatCitation) {
  if (citation.page == null) return citation.documentName;
  return `${citation.documentName} · p. ${citation.page}`;
}

function formatMessageTokens(usage: ChatUsage) {
  return `${usage.totalTokens.toLocaleString()} tokens`;
}

function MessageSources({ citations }: { citations: ChatCitation[] }) {
  if (citations.length === 0) return null;

  return (
    <div className="mt-2 border-t border-border/60 pt-2">
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
        Sources
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((citation) => (
          <li key={`${citation.documentId}:${citation.page ?? ""}`}>
            <a
              href={`/api/documents/${citation.documentId}/open`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-muted"
              title={citationLabel(citation)}
            >
              <FileText className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate">{citationLabel(citation)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DashboardChat() {
  const { setSessionTokensUsed } = useChatSession();
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: INITIAL_ASSISTANT_ID,
      role: "assistant",
      content: "Upload documents on the left, then ask questions here.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Keep the budget footer in sync with the sum of per-message totals.
  React.useEffect(() => {
    const total = messages.reduce(
      (sum, m) => sum + (m.usage?.totalTokens ?? 0),
      0,
    );
    setSessionTokensUsed(total);
  }, [messages, setSessionTokensUsed]);

  // Session-only history: one entry for the current in-memory conversation.
  const sessionHistory = React.useMemo(() => {
    const userMessages = messages.filter((m) => m.role === "user");
    if (userMessages.length === 0) return [];

    const firstUser = userMessages[0]!;
    const last = messages[messages.length - 1]!;
    return [
      {
        id: "session-current",
        title: firstUser.content,
        lastMessage: last.content,
      },
    ];
  }, [messages]);

  // Frontend function to stream the chat response from the model.
  const streamChat = React.useCallback(
    async (apiMessages: Array<{ role: "user" | "assistant"; content: string }>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const assistantId = newMessageId("assistant");
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setIsStreaming(true);
      setAwaitingFirstToken(true);

      // patchAssistant is used to patch the assistant's content.
      const patchAssistant = (patch: Partial<ChatMessage>) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
        );
      };

      // appendDelta is used to append the delta to the assistant's content.
      const appendDelta = (text: string) => {
        setAwaitingFirstToken(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + text } : m,
          ),
        );
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: apiMessages }),
          signal: controller.signal,
        });

        const contentType = res.headers.get("content-type") ?? "";

        // Auth / validation failures still return JSON.
        if (!contentType.includes("text/event-stream")) {
          const data = (await res.json()) as ChatApiError;
          throw new Error(data.error || "Chat request failed");
        }

        if (!res.ok || !res.body) {
          throw new Error("Chat request failed");
        }

        let streamError: string | null = null;

        await readChatSse(
          res.body,
          (event) => {
            switch (event.type) {
              // update content
              case "delta":
                appendDelta(event.text);
                break;
              // update misc: citations and usage
              case "citations":
                patchAssistant({ citations: event.citations });
                break;
              case "usage":
                patchAssistant({ usage: event.usage });
                break;
              case "error":
                streamError = event.error;
                break;
              case "done":
                break;
            }
          },
          controller.signal,
        );

        if (controller.signal.aborted) return;

        if (streamError) {
          throw new Error(streamError);
        }

        setMessages((prev) => {
          const assistant = prev.find((m) => m.id === assistantId);
          if (assistant && !assistant.content.trim()) {
            return prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: "No response generated." }
                : m,
            );
          }
          return prev;
        });
      } catch (error) {
        if (controller.signal.aborted) return;

        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        toast.error("Chat failed", {
          description:
            error instanceof Error ? error.message : "Could not get a response",
        });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsStreaming(false);
        setAwaitingFirstToken(false);
      }
    },
    [],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle empty input or streaming.
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    // Create latest user message object.
    const userMessage: ChatMessage = {
      id: newMessageId("user"),
      role: "user",
      content: trimmed,
    };
    // append the user message to the messages array.
    const nextMessages = [...messages, userMessage];

    // update input and messages state [BOTH update UI]
    setInput("");
    setMessages(nextMessages);
    // stream the chat response from the model and pass in new appended messages array.
    // toApiMessages converts the messages array to the format expected by the API.
    void streamChat(toApiMessages(nextMessages));
  };

  // Drop the last assistant turn and re-stream from the prior messages (same SSE path).
  // Session token total recomputes from remaining message usages (old reply removed, new usage added).
  const onRegenerate = () => {
    if (isStreaming) return;

    const target = getRegenerateTarget(messages);
    if (!target) return;

    setMessages(target.priorMessages);
    void streamChat(toApiMessages(target.priorMessages));
  };

  const regenerateTarget = isStreaming ? null : getRegenerateTarget(messages);

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[7fr_3fr] gap-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Chat</CardTitle>
        </CardHeader>

        <CardContent className="min-h-0 flex flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 flex-1 overflow-y-auto pr-2">
            <div className="space-y-3">
              {messages.map((m) => {
                const isEmptyStreamingAssistant =
                  m.role === "assistant" &&
                  !m.content &&
                  isStreaming &&
                  awaitingFirstToken;

                if (isEmptyStreamingAssistant) return null;

                return (
                  <div
                    key={m.id}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-primary/5 border-primary/20"
                        : "bg-background",
                    ].join(" ")}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-muted-foreground">
                        {m.role === "user" ? "You" : "Assistant"}
                      </div>
                      {regenerateTarget?.assistantId === m.id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground"
                          onClick={onRegenerate}
                          disabled={isStreaming}
                        >
                          <RefreshCw className="size-3" />
                          Regenerate
                        </Button>
                      ) : null}
                    </div>
                    <div className="whitespace-pre-wrap">{m.content}</div>
                    {m.role === "assistant" && m.usage ? (
                      <div className="mt-1.5 text-xs text-muted-foreground">
                        {formatMessageTokens(m.usage)}
                      </div>
                    ) : null}
                    {m.role === "assistant" && m.citations ? (
                      <MessageSources citations={m.citations} />
                    ) : null}
                  </div>
                );
              })}
              {awaitingFirstToken ? (
                <div className="text-sm text-muted-foreground">
                  Assistant is thinking…
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>

        <CardFooter>
          <form onSubmit={onSubmit} className="flex w-full items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message here..."
              className="min-h-[2.2rem] max-h-32 resize-none"
              disabled={isStreaming}
            />
            <Button type="submit" disabled={isStreaming || !input.trim()}>
              <SendIcon className="size-4" />
            </Button>
          </form>
        </CardFooter>
      </Card>

      <Card className="min-h-0">
        <CardHeader>
          <CardTitle className="text-base">Chat History</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0">
          <div className="max-h-full space-y-2 overflow-y-auto pr-2">
            {sessionHistory.length === 0 ? (
              <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                <MessageSquare className="size-4" />
                <div>No chat history yet.</div>
                <div className="text-xs">Start a conversation to see it here.</div>
              </div>
            ) : (
              sessionHistory.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="truncate text-sm font-medium">{item.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {item.lastMessage}
                  </div>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
