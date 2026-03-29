/**
 * Ingest queue — Upstash Redis (REST) from Next.js API routes.
 *
 * **What this file does:** appends JSON job messages to a Redis **list** named `queue:ingest`.
 * The background **worker** (separate process on Railway/Render) should **pop** those messages
 * using a blocking pop (`BLPOP` or `BRPOP`) over the Redis protocol — not implemented here.
 *
 * **RPUSH:** we push onto the **right** (tail) of the list. For FIFO, the worker should use
 * **`BLPOP queue:ingest`** (pop from the **left**) so the oldest job is processed first.
 * (Alternatively: `LPUSH` here + `BRPOP` in the worker — same FIFO idea.)
 *
 * **Retries:** network blips to Upstash are retried a few times; if all fail, the DB row still
 * exists as `pending` and `/api/cron/reconcile-ingest` can RPUSH again later.
 */

import { Redis } from "@upstash/redis";
import type { DocumentIngestQueuePayload } from "@/lib/queue/document-ingest-payload";

/** Redis list key shared with the worker consumer. */
export const DOCUMENT_INGEST_QUEUE_KEY = "queue:ingest";

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
 * Serializes `payload` to JSON and **RPUSH**es it onto `DOCUMENT_INGEST_QUEUE_KEY`.
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
      // Redis: append one job string to the tail of the list (producer side of the queue).
      await redis.rpush(DOCUMENT_INGEST_QUEUE_KEY, value);
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

const RECONCILE_LOCK_PREFIX = "reconcile:lock:";
const RECONCILE_LOCK_TTL_SECONDS = 120;

/**
 * Tries to claim a short-lived Redis lock for `documentId` so two concurrent cron runs
 * do not RPUSH duplicate jobs for the same document. `SET key NX EX` = set only if absent, with TTL.
 */
export async function tryAcquireReconcileLock(
  documentId: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const key = `${RECONCILE_LOCK_PREFIX}${documentId}`;
  try {
    const result = await redis.set(key, "1", {
      ex: RECONCILE_LOCK_TTL_SECONDS,
      nx: true,
    });
    return result === "OK";
  } catch {
    return false;
  }
}
