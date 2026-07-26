"use client";

import * as React from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  SendIcon,
} from "lucide-react";
import { canAdjustSystemPrompt } from "@/lib/auth/roles";
import { readChatSse } from "@/lib/chat/read-sse";
import type { ChatCitation, ChatUsage } from "@/lib/chat/types";
import type {
  ConversationDetail,
  ConversationListItem,
} from "@/types/conversation";
import { useAuth } from "@/features/auth/useAuth";
import { useChatControls } from "./chat-controls-context";
import {
  JsonModeBadge,
  JsonModeToggle,
  ModelSelect,
  SystemPromptControl,
  TemplatesControl,
  TypingIndicator,
} from "./chat-controls-ui";
import { useChatSession } from "./chat-session-context";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  usage?: ChatUsage;
  /** Set when this assistant reply was requested with JSON mode on (UI-only until API persists it). */
  jsonMode?: boolean;
};

type ChatApiError = {
  error: string;
};

function newMessageId(prefix: string) {
  return crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}`;
}

function toApiMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }));
}

/** Last turn is a real assistant reply that can be regenerated from its preceding user message. */
function getRegenerateTarget(messages: ChatMessage[]) {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") {
    return null;
  }

  const prior = messages.slice(0, -1);
  const lastUser = [...prior].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;

  return {
    assistantId: last.id,
    priorMessages: prior,
    previousUsage: last.usage ?? null,
  };
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

function ChatEmptyState() {
  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-4 text-center">
      <div className="flex size-10 items-center justify-center rounded-full border bg-muted/40">
        <MessageSquare className="size-4 text-muted-foreground" />
      </div>
      <div className="text-sm font-medium">Ask about your documents</div>
      <p className="max-w-xs text-xs text-muted-foreground">
        Upload files on the left, then type a question below to get started.
      </p>
    </div>
  );
}

function ConversationLoadingState() {
  return (
    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-4 text-center">
      <Loader2
        className="size-5 animate-spin text-muted-foreground"
        aria-hidden
      />
      <div className="text-sm text-muted-foreground">Loading conversation…</div>
    </div>
  );
}

function detailToMessages(detail: ConversationDetail): ChatMessage[] {
  return detail.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    citations: m.citations.length > 0 ? m.citations : undefined,
    usage: m.usage ?? undefined,
  }));
}

export default function DashboardChat() {
  const queryClient = useQueryClient();
  const { setSessionTokensUsed, adjustSessionTokensUsed } = useChatSession();
  const { role } = useAuth();
  const {
    model,
    systemPrompt,
    jsonMode,
    setActiveConversation,
    prepareNewChat,
  } = useChatControls();
  const canSetSystemPrompt = canAdjustSystemPrompt(role);
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [awaitingFirstToken, setAwaitingFirstToken] = React.useState(false);
  const [loadingConversationId, setLoadingConversationId] = React.useState<
    string | null
  >(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const conversationIdRef = React.useRef<string | null>(null);
  const controlsRef = React.useRef({
    model,
    systemPrompt,
    jsonMode,
    canSetSystemPrompt,
  });

  React.useEffect(() => {
    conversationIdRef.current = conversationId;
    setActiveConversation(conversationId);
  }, [conversationId, setActiveConversation]);

  React.useEffect(() => {
    controlsRef.current = {
      model,
      systemPrompt,
      jsonMode,
      canSetSystemPrompt,
    };
  }, [model, systemPrompt, jsonMode, canSetSystemPrompt]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const {
    data: historyData,
    isPending: historyLoading,
    isError: historyError,
  } = useQuery({
    queryKey: ["conversations"],
    queryFn: async (): Promise<{
      conversations: ConversationListItem[];
      orgTokensUsed: number;
    }> => {
      const res = await fetch("/api/conversations", {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json()) as
        | { conversations: ConversationListItem[]; orgTokensUsed: number }
        | { error: string };

      if (!res.ok) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to load conversations",
        );
      }
      if (!("conversations" in payload)) {
        throw new Error("Invalid response from server");
      }
      return {
        conversations: payload.conversations,
        orgTokensUsed: payload.orgTokensUsed ?? 0,
      };
    },
  });

  // Keep the budget footer in sync with durable org token totals.
  React.useEffect(() => {
    if (historyData) {
      setSessionTokensUsed(historyData.orgTokensUsed);
    }
  }, [historyData, setSessionTokensUsed]);

  // Persisted history: conversations loaded from GET /api/conversations.
  const conversations = historyData?.conversations ?? [];

  // Frontend function to stream the chat response from the model.
  const streamChat = React.useCallback(
    async (
      apiMessages: Array<{ role: "user" | "assistant"; content: string }>,
      options?: {
        regenerate?: boolean;
        previousUsageTotal?: number;
      },
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const controls = controlsRef.current;
      const assistantId = newMessageId("assistant");
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          jsonMode: controls.jsonMode || undefined,
        },
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

      let streamedUsageTotal: number | null = null;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            conversationId: conversationIdRef.current,
            regenerate: options?.regenerate === true,
            // model / jsonMode: UI ready; backend may ignore until later slices.
            model: controls.model,
            jsonMode: controls.jsonMode,
            ...(controls.canSetSystemPrompt
              ? { systemPrompt: controls.systemPrompt }
              : {}),
          }),
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
              case "conversation":
                setConversationId(event.conversationId);
                conversationIdRef.current = event.conversationId;
                break;
              // update content
              case "delta":
                appendDelta(event.text);
                break;
              // update misc: citations and usage
              case "citations":
                patchAssistant({ citations: event.citations });
                break;
              case "usage":
                streamedUsageTotal = event.usage.totalTokens;
                patchAssistant({ usage: event.usage });
                break;
              case "error":
                streamError = event.error;
                break;
              case "done":
                if (event.conversationId) {
                  setConversationId(event.conversationId);
                  conversationIdRef.current = event.conversationId;
                }
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

        if (options?.regenerate) {
          const removed = options.previousUsageTotal ?? 0;
          const added = streamedUsageTotal ?? 0;
          adjustSessionTokensUsed(added - removed);
        } else if (streamedUsageTotal != null) {
          adjustSessionTokensUsed(streamedUsageTotal);
        }

        void queryClient.invalidateQueries({ queryKey: ["conversations"] });
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
    [adjustSessionTokensUsed, queryClient],
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
    void streamChat(toApiMessages(target.priorMessages), {
      regenerate: Boolean(conversationIdRef.current),
      previousUsageTotal: target.previousUsage?.totalTokens ?? 0,
    });
  };

  const onNewChat = () => {
    if (isStreaming) return;
    abortRef.current?.abort();
    prepareNewChat();
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setInput("");
  };

  const onSelectConversation = async (id: string) => {
    if (isStreaming || id === conversationId || loadingConversationId) return;

    const previousMessages = messages;
    const previousInput = input;

    abortRef.current?.abort();
    setLoadingConversationId(id);
    setMessages([]);
    setInput("");

    try {
      const res = await fetch(`/api/conversations/${id}`, {
        credentials: "include",
        cache: "no-store",
      });
      const payload = (await res.json()) as
        | { conversation: ConversationDetail }
        | { error: string };

      if (!res.ok || !("conversation" in payload)) {
        throw new Error(
          "error" in payload ? payload.error : "Failed to load conversation",
        );
      }

      setConversationId(payload.conversation.id);
      conversationIdRef.current = payload.conversation.id;
      setMessages(detailToMessages(payload.conversation));
    } catch (error) {
      setMessages(previousMessages);
      setInput(previousInput);
      toast.error("Could not open conversation", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setLoadingConversationId(null);
    }
  };

  const isLoadingConversation = loadingConversationId !== null;
  const chatBusy = isStreaming || isLoadingConversation;
  const regenerateTarget = chatBusy ? null : getRegenerateTarget(messages);
  const canSend = !chatBusy && Boolean(input.trim());
  const showEmptyState =
    messages.length === 0 && !isStreaming && !isLoadingConversation;

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[7fr_3fr] gap-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <CardTitle className="text-base">Chat</CardTitle>
            <SystemPromptControl disabled={chatBusy} />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onNewChat}
            disabled={chatBusy}
          >
            <Plus className="size-3.5" />
            New chat
          </Button>
        </CardHeader>

        <CardContent className="min-h-0 flex flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 flex-1 overflow-y-auto pr-2">
            {isLoadingConversation ? (
              <ConversationLoadingState />
            ) : showEmptyState ? (
              <ChatEmptyState />
            ) : (
              <div className="space-y-3">
                {messages.map((m) => {
                  const isTypingBubble =
                    m.role === "assistant" &&
                    !m.content &&
                    isStreaming &&
                    awaitingFirstToken;

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
                        <div className="flex items-center gap-1.5">
                          <div className="text-xs font-medium text-muted-foreground">
                            {m.role === "user" ? "You" : "Assistant"}
                          </div>
                          {m.role === "assistant" && m.jsonMode ? (
                            <JsonModeBadge />
                          ) : null}
                        </div>
                        {regenerateTarget?.assistantId === m.id ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-muted-foreground"
                            onClick={onRegenerate}
                            disabled={isStreaming}
                          >
                            <RefreshCw className="size-3" />
                            Regenerate
                          </Button>
                        ) : null}
                      </div>
                      {isTypingBubble ? (
                        <TypingIndicator />
                      ) : (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      )}
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
              </div>
            )}
          </div>
        </CardContent>

        <CardFooter>
          <form onSubmit={onSubmit} className="w-full">
            <div
              className={[
                "flex w-full flex-col rounded-xl border border-input bg-transparent shadow-xs transition-[color,box-shadow]",
                "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
                "dark:bg-input/30",
              ].join(" ")}
            >
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key !== "Enter" ||
                    e.shiftKey ||
                    e.nativeEvent.isComposing
                  ) {
                    return;
                  }
                  e.preventDefault();
                  if (canSend) {
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask a question…"
                rows={1}
                disabled={chatBusy}
                className={[
                  "max-h-[7.5rem] min-h-10 resize-none overflow-y-auto border-0 bg-transparent px-3 pt-3 pb-2 shadow-none",
                  "field-sizing-content leading-5 md:text-sm",
                  "focus-visible:border-transparent focus-visible:ring-0",
                  "dark:bg-transparent",
                  chatBusy ? "cursor-not-allowed opacity-70" : "",
                ].join(" ")}
              />
              <div className="flex items-center justify-between gap-2 px-2 pb-2">
                <div className="flex min-w-0 items-center gap-1">
                  <ModelSelect disabled={chatBusy} />
                  <TemplatesControl
                    composerValue={input}
                    onInsert={setInput}
                    disabled={chatBusy}
                  />
                  <JsonModeToggle disabled={chatBusy} />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="submit"
                        size="icon-sm"
                        className="size-8 disabled:opacity-40"
                        disabled={!canSend}
                        aria-label="Send message"
                      >
                        <SendIcon className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {canSend
                        ? "Send · Enter"
                        : isStreaming
                          ? "Waiting for reply…"
                          : isLoadingConversation
                            ? "Loading conversation…"
                            : "Type a message to send"}
                    </p>
                    <p className="text-muted-foreground">
                      Shift+Enter for new line
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </form>
        </CardFooter>
      </Card>

      <Card className="min-h-0">
        <CardHeader>
          <CardTitle className="text-base">Chat History</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0">
          <div className="max-h-full space-y-2 overflow-y-auto pr-2">
            {historyLoading ? (
              <div className="text-sm text-muted-foreground">Loading…</div>
            ) : historyError ? (
              <div className="text-sm text-muted-foreground">
                Could not load history.
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                <MessageSquare className="size-4" />
                <div>No chat history yet.</div>
                <div className="text-xs">Start a conversation to see it here.</div>
              </div>
            ) : (
              conversations.map((item) => {
                const isActive = item.id === conversationId;
                const isLoading = item.id === loadingConversationId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={chatBusy}
                    onClick={() => void onSelectConversation(item.id)}
                    className={[
                      "w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
                      "disabled:cursor-not-allowed",
                      isActive
                        ? "border-primary/40 bg-primary/5"
                        : "bg-background hover:bg-muted/50",
                      chatBusy || isLoading ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <div className="truncate text-sm font-medium">
                      {item.title}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {item.lastMessage ?? "No messages yet"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
