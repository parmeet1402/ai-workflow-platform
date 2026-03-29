import type { SupabaseClient } from "@supabase/supabase-js";

export type ClaimedDocument = {
  id: string;
  organization_id: string;
  storage_path: string;
  name: string;
  ingest_correlation_id: string | null;
};

/**
 * CAS: pending → processing. Returns the row only if this worker won the claim.
 */
export async function claimDocumentForProcessing(
  supabase: SupabaseClient,
  documentId: string,
): Promise<ClaimedDocument | null> {
  const startedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("documents")
    .update({
      processing_status: "processing",
      processing_started_at: startedAt,
    })
    .eq("id", documentId)
    .eq("processing_status", "pending")
    .select("id, organization_id, storage_path, name, ingest_correlation_id")
    .maybeSingle();

  if (error) {
    throw new Error(`claim document failed: ${error.message}`);
  }

  return data as ClaimedDocument | null;
}

export type ChunkForRpc = {
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[];
};

export async function finalizeDocumentIngest(
  supabase: SupabaseClient,
  documentId: string,
  organizationId: string,
  chunks: ChunkForRpc[],
): Promise<void> {
  const { error } = await supabase.rpc("worker_finalize_document_ingest", {
    p_document_id: documentId,
    p_organization_id: organizationId,
    p_chunks: chunks,
  });

  if (error) {
    throw new Error(`finalize ingest failed: ${error.message}`);
  }
}

export async function failDocumentProcessing(
  supabase: SupabaseClient,
  documentId: string,
  organizationId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.rpc("worker_fail_document_processing", {
    p_document_id: documentId,
    p_organization_id: organizationId,
    p_error: message,
  });

  if (error) {
    console.error(
      JSON.stringify({
        stage: "fail_rpc_error",
        documentId,
        organizationId,
        message: error.message,
      }),
    );
  }
}
