import type { RetrievedChunk } from "@/lib/chat/types";

export const RAG_SYSTEM_PROMPT = `You are a helpful assistant that answers questions using only the provided document context.

Rules:
- Answer only from the context below. If the context does not contain enough information, say you do not know based on the available documents.
- Do not invent facts, citations, or document content.
- Prefer concise, direct answers.
- When relevant, mention the document name and page number from the context labels.`;

/**
 * Format retrieved chunks into a labeled context block for the system/user prompt.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "(No matching document excerpts were found.)";
  }

  return chunks
    .map((chunk, i) => {
      const page =
        typeof chunk.metadata.page === "number" ? chunk.metadata.page : null;
      const pageLabel = page != null ? `, page ${page}` : "";
      const header = `[${i + 1}] ${chunk.documentName}${pageLabel} (similarity ${chunk.similarity.toFixed(3)})`;
      return `${header}\n${chunk.content.trim()}`;
    })
    .join("\n\n");
}

/**
 * Build the grounded system message (instructions + retrieved excerpts).
 */
export function buildRagSystemMessage(chunks: RetrievedChunk[]): string {
  return `${RAG_SYSTEM_PROMPT}\n\nDocument context:\n${formatRetrievedContext(chunks)}`;
}

/**
 * OpenAI chat messages for a single-turn RAG completion (non-streaming CP1).
 * Multi-turn history can be prepended by the route later.
 */
export function buildRagMessages(options: {
  question: string;
  chunks: RetrievedChunk[];
}): Array<{ role: "system" | "user"; content: string }> {
  const question = options.question.trim();
  return [
    { role: "system", content: buildRagSystemMessage(options.chunks) },
    { role: "user", content: question },
  ];
}
