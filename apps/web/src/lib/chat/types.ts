/** One chunk returned from org-scoped vector KNN retrieval. */
export type RetrievedChunk = {
  documentId: string;
  documentName: string;
  content: string;
  chunkIndex: number;
  metadata: Record<string, unknown>;
  /** Cosine similarity in [0, 1] (1 − distance). */
  similarity: number;
};

/** Citation payload for the chat UI (document + optional page). */
export type ChatCitation = {
  documentId: string;
  documentName: string;
  page: number | null;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** SSE event shapes used once streaming lands (CP2). */
export type ChatSseDeltaEvent = { type: "delta"; text: string };
export type ChatSseCitationsEvent = { type: "citations"; citations: ChatCitation[] };
export type ChatSseUsageEvent = { type: "usage"; usage: ChatUsage };
export type ChatSseDoneEvent = { type: "done" };
export type ChatSseErrorEvent = { type: "error"; error: string };

export type ChatSseEvent =
  | ChatSseDeltaEvent
  | ChatSseCitationsEvent
  | ChatSseUsageEvent
  | ChatSseDoneEvent
  | ChatSseErrorEvent;
