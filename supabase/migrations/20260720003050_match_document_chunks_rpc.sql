-- RAG retrieval support for Phase 1 AI Chat (schema only).
--
-- Migrations own tables/indexes. The KNN query itself lives in the Next.js backend
-- (`apps/web/src/lib/chat/retrieval.ts`) so auth, org scoping, and retrieval logic
-- stay in one place rather than a SECURITY DEFINER RPC.

-- Without this index, ORDER BY embedding <=> query would scan every chunk row and
-- compute cosine distance one-by-one (fine for a handful of docs, costly as orgs
-- accumulate thousands of chunks). HNSW is an approximate nearest-neighbor graph
-- index: the Next.js retrieval query orders by `embedding <=> $query_embedding`
-- (cosine distance) and LIMIT k, and the planner can use this index for that
-- operator family (vector_cosine_ops) instead of a sequential scan.
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw
  ON public.document_chunks
  USING hnsw (embedding vector_cosine_ops);
