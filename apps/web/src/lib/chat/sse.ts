import type { ChatSseEvent } from "@/lib/chat/types";

/**
 * Format a chat SSE event for `text/event-stream`.
 * Uses `event:` + JSON `data:` so the client can dispatch by event name.
 */
export function formatSseEvent(event: ChatSseEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "private, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;
