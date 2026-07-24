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
  // This function is used to retrieve the relevant chunks from the database.
  // Input: The organization ID, the user's question, and the number of chunks to retrieve.
  // Output: The relevant chunks.
  const {
    organizationId,
    query,
    matchCount = getRagMatchCount(),
    client = createOpenAIClient(),
  } = options;

  // create the vector embedding for the query.
  const embedding = await createQueryEmbedding(query, client);
  // convert the embedding to a vector literal for the SQL query.
  const vectorLiteral = toVectorLiteral(embedding);
  const sql = getSql();

  // Cosine KNN over chunk embeddings (pgvector `<=>`; HNSW index uses vector_cosine_ops).
  // Cast the query vector to vector(1536) to match document_chunks.embedding.
  // Similarity = 1 − distance (higher is closer). ORDER BY distance ASC, then take top-k.
  //
  // INNER JOIN documents ON d.id = dc.document_id:
  // - Each chunk row only exists for a parent document; the join attaches that parent.
  // - INNER (not LEFT) drops orphan chunks if a document were missing (shouldn't happen).
  // - organization_id and processing_status live on documents, not chunks — we need the
  //   join to scope retrieval to this org and only include fully ingested ("ready") docs.
  // - d.name is selected as document_name for citation labels in the chat UI.

  // dc here is the chunk table.
  // d here is the document table.
  // (1 - (dc.embedding <=> ${vectorLiteral}::public.vector(1536)))::float8 AS similarity here is the similarity score between the chunk embedding and the query embedding.
  // ::float8 here means the similarity score is casted to float8.
  // ::uuid here means the organization ID is a UUID.
  // ::public.vector(1536) here means the embedding is a vector of 1536 dimensions.
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
