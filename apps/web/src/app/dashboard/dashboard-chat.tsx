"use client";

import * as React from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FileText, MessageSquare, SendIcon } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function DashboardChat() {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "assistant-initial",
      role: "assistant",
      content: "Upload documents on the left, then ask questions here.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [isThinking, setIsThinking] = React.useState(false);
  const chatHistory = [
    { id: "hist-1", title: "Onboarding Q&A", lastMessage: "How do I upload PDFs?" },
    { id: "hist-2", title: "Pricing Discussion", lastMessage: "Show token cost breakdown" },
    { id: "hist-3", title: "RAG Setup", lastMessage: "How do I chunk documents?" },
    { id: "hist-4", title: "Prompt Tuning", lastMessage: "Refine summarization prompt" },
  ];

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: (crypto?.randomUUID?.() ?? `user-${Date.now()}`), role: "user", content: trimmed },
    ]);

    setIsThinking(true);
    // Placeholder assistant response. Replace with your real chat call.
    await new Promise((r) => setTimeout(r, 500));
    setMessages((prev) => [
      ...prev,
      {
        id: (crypto?.randomUUID?.() ?? `assistant-${Date.now()}`),
        role: "assistant",
        content: "Got it. This is a placeholder response for the dashboard chat UI.",
      },
    ]);
    setIsThinking(false);
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
            {chatHistory.length === 0 ? (
              <div className="flex min-h-[8rem] flex-col items-center justify-center gap-2 rounded-lg border bg-background/50 px-3 py-6 text-center text-sm text-muted-foreground">
                <MessageSquare className="size-4" />
                <div>No chat history yet.</div>
                <div className="text-xs">Start a conversation to see it here.</div>
              </div>
            ) : (
              chatHistory.map((item) => (
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

