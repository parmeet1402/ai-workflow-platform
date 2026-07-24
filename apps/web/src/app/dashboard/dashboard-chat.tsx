"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, SendIcon } from "lucide-react";
import type { ChatCitation, ChatUsage } from "@/lib/chat/types";

const INITIAL_ASSISTANT_ID = "assistant-initial";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatApiSuccess = {
  answer: string;
  citations: ChatCitation[];
  usage: ChatUsage;
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

export default function DashboardChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: INITIAL_ASSISTANT_ID,
      role: "assistant",
      content: "Upload documents on the left, then ask questions here.",
    },
  ]);
  const [input, setInput] = React.useState("");

  const chatMutation = useMutation({
    mutationFn: async (apiMessages: Array<{ role: "user" | "assistant"; content: string }>) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });

      const data = (await res.json()) as ChatApiSuccess | ChatApiError;
      if (!res.ok || "error" in data) {
        throw new Error(
          "error" in data && data.error
            ? data.error
            : "Chat request failed",
        );
      }
      return data;
    },
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          id: newMessageId("assistant"),
          role: "assistant",
          content: data.answer,
        },
      ]);
    },
    onError: (error) => {
      toast.error("Chat failed", {
        description:
          error instanceof Error ? error.message : "Could not get a response",
      });
    },
  });

  const isThinking = chatMutation.isPending;

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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    const userMessage: ChatMessage = {
      id: newMessageId("user"),
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...messages, userMessage];

    setInput("");
    setMessages(nextMessages);
    chatMutation.mutate(toApiMessages(nextMessages));
  };

  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-[7fr_3fr] gap-4">
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Chat</CardTitle>
        </CardHeader>

        <CardContent className="min-h-0 flex flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 flex-1 overflow-y-auto pr-2">
            <div className="space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={[
                    "rounded-lg border px-3 py-2 text-sm",
                    m.role === "user"
                      ? "bg-primary/5 border-primary/20"
                      : "bg-background",
                  ].join(" ")}
                >
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  <div className="whitespace-pre-wrap">{m.content}</div>
                </div>
              ))}
              {isThinking ? (
                <div className="text-sm text-muted-foreground">Assistant is thinking…</div>
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
              disabled={isThinking}
            />
            <Button type="submit" disabled={isThinking || !input.trim()}>
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
