import type { ChatSseEvent } from "@/lib/chat/types";

const EVENT_TYPES = new Set([
  "delta",
  "citations",
  "usage",
  "done",
  "error",
]);

/**
 * Parse SSE frames from a POST `text/event-stream` body.
 * Compatible with `event: <type>` + `data: <json>` framing from `formatSseEvent`.
 * Frontend function to subscribe to the chat SSE event stream.
 */
export async function readChatSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Create a ReadableStream to read the bytes stream of data from the server.
  // reader has read() method to read the bytes stream of data from the stream (in bytes).
  // reader has cancel() method to cancel the stream of data from the stream.
  // reader has releaseLock() method to release the lock on the stream.
  const reader = body.getReader();
  // Create a TextDecoder to decode the stream of data from the server.
  // Example: Uint8Array to string.
  // TextDecoder has decode() method to decode the stream of data from the stream (in bytes) to string.
  const decoder = new TextDecoder();
  // This is a temporary store to hold while all chunks are received.
  let buffer = "";

  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  // Abort the stream of data from the server.
  signal?.addEventListener("abort", abort, { once: true });

  try {
    // This is the main reading loop, keeps reading until the stream ends or abort happens
    while (true) {
      if (signal?.aborted) break;

      // Read one chunk of data from the stream
      const { done, value } = await reader.read();
      // If the stream ends, break the loop.
      if (done) break;

      // Stream in bytes is decoded to string using TextDecoder.
      // and pass in the stream flag to decode the stream of data from the stream (in bytes) to string.
      // This is to handle the case where the stream of data from the stream is not complete.
      buffer += decoder.decode(value, { stream: true });
      // Consume the stream of data from the stream.
      buffer = consumeSseBuffer(buffer, onEvent);
    }

    // Do the same for the last chunk of data from the stream.
    buffer += decoder.decode();
    if (buffer.trim()) {
      consumeSseBuffer(`${buffer}\n\n`, onEvent);
    }
  } finally {
    // Remove the event listener from the stream.
    signal?.removeEventListener("abort", abort);
    // Release the lock on the stream.
    reader.releaseLock();
  }
}

/**
 * Split the accumulated text buffer into complete SSE frames and fire `onEvent`
 * for each one. Network chunks rarely align with frame boundaries, so `readChatSse`
 * keeps leftover text in `buffer` and only asks us to emit once a full frame
 * (ending in `\n\n`, matching `formatSseEvent` on the server) is available.
 * Returns whatever trailing bytes are still incomplete so the next chunk can
 * finish the frame — without this, mid-token deltas would be dropped or garbled.
 */
function consumeSseBuffer(
  buffer: string,
  onEvent: (event: ChatSseEvent) => void,
): string {
  let rest = buffer;

  // Walk the buffer frame-by-frame. Each `\n\n` is the SSE "message complete"
  // marker the server wrote after `event:` + `data:` — until we see it, the
  // UI must not treat the partial text as a chat event.
  while (true) {
    const sep = rest.indexOf("\n\n");
    // No complete frame yet: hold everything for the next network chunk.
    if (sep === -1) break;

    // Peel off one framed message; keep the remainder for the next iteration
    // (or the next `read()` if this was the last complete frame).
    const rawFrame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);

    // Turn wire text into a typed ChatSseEvent and hand it to the dashboard
    // (delta → append tokens, citations/usage/done/error → update UI state).
    const event = parseSseFrame(rawFrame);
    if (event) onEvent(event);
  }

  // Incomplete trailing frame — caller stores this and appends the next decode.
  return rest;
}

/**
 * Parse one SSE message (`event: …` + `data: …`) into a ChatSseEvent.
 * This is the client counterpart of `formatSseEvent`: only well-formed,
 * known event types reach the chat UI; junk/keepalive/partial JSON is ignored
 * so a bad frame cannot crash the streaming assistant bubble.
 */
function parseSseFrame(rawFrame: string): ChatSseEvent | null {
  let eventName: string | null = null;
  const dataLines: string[] = [];

  // Line-oriented SSE fields. Comments (`:`) are keepalives from proxies;
  // empty lines inside a frame are ignored. We only care about `event` (routing)
  // and `data` (payload) — the contract the API route uses when streaming.
  for (const line of rawFrame.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      // Multiple `data:` lines are joined with `\n` per the SSE spec; our
      // server usually sends one JSON line, but joining keeps us compatible.
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  // Drop frames we cannot route: missing name, unknown type, or no payload.
  // Unknown types stay silent so future server events do not break older clients.
  if (!eventName || !EVENT_TYPES.has(eventName) || dataLines.length === 0) {
    return null;
  }

  // JSON payload must match the declared event name (`type` field). Mismatch or
  // corrupt JSON means the frame is unsafe to apply to message state — skip it.
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as ChatSseEvent;
    if (parsed?.type !== eventName) return null;
    return parsed;
  } catch {
    return null;
  }
}
