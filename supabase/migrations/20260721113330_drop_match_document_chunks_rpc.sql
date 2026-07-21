-- Remove the SECURITY DEFINER match_document_chunks RPC introduced earlier.
-- Vector KNN now runs from the Next.js backend (parameterized SQL after app-level
-- auth + org checks) so retrieval stays with the chat application layer.
-- The HNSW index from 20260720003050_match_document_chunks_rpc.sql is kept.

DROP FUNCTION IF EXISTS public.match_document_chunks(
  public.vector(1536),
  uuid,
  integer,
  double precision
);
