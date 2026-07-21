import type OpenAI from "openai";

import { getSql } from "@/lib/db/postgres";
import {
  createOpenAIClient,
  createQueryEmbedding,
  getRagMatchCount,
} from "@/lib/chat/openai";
import type { RetrievedChunk } from "@/lib/chat/types";

type MatchRow = {
  document_id: string;
  document_name: string;
  content: string | null;
  chunk_index: number;
  metadata: Record<string, unknown> | null;
  similarity: number | string;
};

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/**
 * Embed `query` and return the top-k org-scoped chunks from ready documents.
 * Org filter is applied in SQL; callers must already have verified membership.
 */
export async function retrieveRelevantChunks(options: {
  organizationId: string;
  query: string;
  matchCount?: number;
  client?: OpenAI;
}): Promise<RetrievedChunk[]> {
  const {
    organizationId,
    query,
    matchCount = getRagMatchCount(),
    client = createOpenAIClient(),
  } = options;

  const embedding = await createQueryEmbedding(query, client);
  const vectorLiteral = toVectorLiteral(embedding);
  const sql = getSql();

  // Parameterized KNN: cosine distance via `<=>` (HNSW uses vector_cosine_ops).
  // Similarity = 1 − distance so higher is better.
  const rows = await sql<MatchRow[]>`
    SELECT
      dc.document_id,
      d.name AS document_name,
      dc.content,
      dc.chunk_index,
      dc.metadata,
      (1 - (dc.embedding <=> ${vectorLiteral}::public.vector(1536)))::float8 AS similarity
    FROM public.document_chunks AS dc
    INNER JOIN public.documents AS d ON d.id = dc.document_id
    WHERE d.organization_id = ${organizationId}::uuid
      AND d.processing_status = 'ready'
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> ${vectorLiteral}::public.vector(1536)
    LIMIT ${matchCount}
  `;

  return rows.map((row) => ({
    documentId: row.document_id,
    documentName: row.document_name,
    content: row.content ?? "",
    chunkIndex: row.chunk_index,
    metadata: row.metadata ?? {},
    similarity: Number(row.similarity),
  }));
}
