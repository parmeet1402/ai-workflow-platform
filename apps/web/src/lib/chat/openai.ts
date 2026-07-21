import OpenAI from "openai";

/** Must match worker `EMBEDDING_DIMENSIONS` / `document_chunks.embedding vector(1536)`. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Server-only OpenAI client for chat embeddings + completions.
 * Never import from client code.
 */
export function createOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey });
}

export function getChatModel(): string {
  return process.env.CHAT_MODEL?.trim() || "gpt-4o-mini";
}

/** Same model family/dims as the document worker so query vectors are comparable. */
export function getEmbeddingModel(): string {
  return process.env.CHAT_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
}

/** RAG_MATCH_COUNT is the number of chunks to match to the user's question. */
export function getRagMatchCount(): number {
  const raw = process.env.RAG_MATCH_COUNT?.trim();
  if (!raw) return 6;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return 6;
  return Math.min(32, Math.max(1, n));
}

/**
 * Embed a user question for cosine KNN against `document_chunks.embedding`.
 */
export async function createQueryEmbedding(
  text: string,
  client: OpenAI = createOpenAIClient(),
): Promise<number[]> {
  // Input: The user's question.
  // Output: The embedding of the user's question.
  const input = text.trim();
  // Validate the input.
  if (!input) {
    throw new Error("Cannot embed an empty query");
  }

  // Convert the user's question into a vector.
  const res = await client.embeddings.create({
    model: getEmbeddingModel(),
    input,
    dimensions: EMBEDDING_DIMENSIONS,
  });

  const embedding = res.data[0]?.embedding;

  // Validate the embedding.
  if (!embedding?.length) {
    throw new Error("OpenAI embeddings: empty response");
  }

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `OpenAI embeddings: expected ${EMBEDDING_DIMENSIONS} dims, got ${embedding.length}`,
    );
  }

  return embedding as number[];
}
