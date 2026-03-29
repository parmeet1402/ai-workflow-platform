import { utcIsoNow } from "@/lib/datetime";

/**
 * One message on the Redis ingest list (`queue:ingest`). The worker reads this JSON after it
 * pops from Redis, then loads the full row from Postgres (including `storage_path`) — this payload
 * is intentionally small and carries no secrets.
 */
export type DocumentIngestQueuePayload = {
  /** `public.documents.id` — which row to process. */
  documentId: string;
  /** Same as `documents.ingest_correlation_id`; ties logs across upload, queue, and worker. */
  correlationId: string;
  /** `documents.organization_id` — worker can validate against the row. */
  organizationId: string;
  /** When this message was enqueued (ISO-8601 UTC `Z`); for debugging only. */
  enqueuedAt: string;
};

export function createDocumentIngestPayload(
  documentId: string,
  correlationId: string,
  organizationId: string,
): DocumentIngestQueuePayload {
  return {
    documentId,
    correlationId,
    organizationId,
    enqueuedAt: utcIsoNow(),
  };
}
