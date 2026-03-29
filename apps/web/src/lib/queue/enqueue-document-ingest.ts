/**
 * Ingest queue — Upstash Redis (REST) from Next.js API routes.
 *
 * **FIFO contract:** this module **RPUSH**es to the tail of `REDIS_INGEST_QUEUE_KEY`.
 * The worker **BLPOP**s from the head (see `apps/document-worker`).
 *
 * **Retries:** network blips to Upstash are retried a few times; if all fail, the DB row still
 * exists as `pending` and `/api/cron/reconcile-ingest` can RPUSH again later.
 */

import { Redis } from "@upstash/redis";
import type { DocumentIngestQueuePayload } from "@/lib/queue/document-ingest-payload";
import {
  REDIS_INGEST_DLQ_KEY,
  REDIS_INGEST_QUEUE_KEY,
  REDIS_RECONCILE_LOCK_TTL_SECONDS,
  redisReconcileLockKey,
} from "@/lib/queue/redis-keys";

/** @deprecated Use REDIS_INGEST_QUEUE_KEY from redis-keys */
export { DOCUMENT_INGEST_QUEUE_KEY, REDIS_INGEST_QUEUE_KEY } from "@/lib/queue/redis-keys";

export function isUpstashRedisConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getRedis(): Redis | null {
  if (!isUpstashRedisConfigured()) return null;
  return Redis.fromEnv();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type EnqueueResult =
  | { ok: true }
  | { ok: false; error: string; skipped?: boolean };

/**
 * Serializes `payload` to JSON and **RPUSH**es it onto the ingest list (tail).
 * Retries up to 3 times on transient failures.
 * If Redis env is missing, returns `{ ok: false, skipped: true }` so uploads still work in local dev.
 */
export async function enqueueDocumentIngest(
  payload: DocumentIngestQueuePayload,
): Promise<EnqueueResult> {
  const redis = getRedis();
  if (!redis) {
    return {
      ok: false,
      skipped: true,
      error: "Redis not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)",
    };
  }

  const value = JSON.stringify(payload);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await redis.rpush(REDIS_INGEST_QUEUE_KEY, value);
      return { ok: true };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < 2) {
        await sleep(100 * 2 ** attempt);
      }
    }
  }

  return lastError
    ? { ok: false, error: lastError.message }
    : { ok: false, error: "enqueue failed" };
}

/** Record stored on `REDIS_INGEST_DLQ_KEY` (JSON string, **LPUSH**). */
export type IngestDlqRecord = {
  rawMessage: string;
  reason: string;
  at: string;
};

/**
 * **LPUSH**es a diagnostic record onto the dead-letter list (`queue:ingest:dlq`).
 * Use when a message is poisoned or abandoned (worker or future admin tooling).
 */
export async function pushIngestToDlq(
  record: IngestDlqRecord,
): Promise<EnqueueResult> {
  const redis = getRedis();
  if (!redis) {
    return {
      ok: false,
      skipped: true,
      error: "Redis not configured",
    };
  }

  try {
    await redis.lpush(REDIS_INGEST_DLQ_KEY, JSON.stringify(record));
    return { ok: true };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return { ok: false, error: err.message };
  }
}

/**
 * Tries to claim a short-lived Redis lock for `documentId` so two concurrent cron runs
 * do not RPUSH duplicate jobs for the same document. `SET key NX EX` = set only if absent, with TTL.
 */
export async function tryAcquireReconcileLock(
  documentId: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const key = redisReconcileLockKey(documentId);
  try {
    const result = await redis.set(key, "1", {
      ex: REDIS_RECONCILE_LOCK_TTL_SECONDS,
      nx: true,
    });
    return result === "OK";
  } catch {
    return false;
  }
}
