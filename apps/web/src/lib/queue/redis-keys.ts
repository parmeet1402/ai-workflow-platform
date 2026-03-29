/**
 * Single source of truth for Upstash Redis key names.
 * The worker in `apps/document-worker` duplicates these string values; keep them in sync.
 */

/** Main ingest FIFO list: Next.js **RPUSH** (tail); worker **BLPOP** (head) = oldest job first. */
export const REDIS_INGEST_QUEUE_KEY = "queue:ingest";

/**
 * Dead-letter list for jobs that cannot be processed (malformed JSON, repeated failures, etc.).
 * **LPUSH** adds to the head so operators can inspect recent failures first.
 */
export const REDIS_INGEST_DLQ_KEY = "queue:ingest:dlq";

export const REDIS_RECONCILE_LOCK_PREFIX = "reconcile:lock:";

export const REDIS_RECONCILE_LOCK_TTL_SECONDS = 120;

export function redisReconcileLockKey(documentId: string): string {
  return `${REDIS_RECONCILE_LOCK_PREFIX}${documentId}`;
}

/** @deprecated Use REDIS_INGEST_QUEUE_KEY */
export const DOCUMENT_INGEST_QUEUE_KEY = REDIS_INGEST_QUEUE_KEY;
