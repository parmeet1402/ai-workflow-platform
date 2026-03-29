/**
 * TCP consumer for Upstash Redis. Uses **BLPOP** on the ingest list head so jobs
 * enqueued with **RPUSH** on the Next.js side are processed FIFO.
 */
import type { Redis as RedisClient } from "ioredis";

import { REDIS_INGEST_DLQ_KEY, REDIS_INGEST_QUEUE_KEY } from "./redis-keys.js";

export type ParsedIngestJob = {
  documentId: string;
  correlationId: string;
  organizationId: string;
  enqueuedAt: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseIngestPayload(raw: string): ParsedIngestJob | null {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const { documentId, correlationId, organizationId, enqueuedAt } = data;
  if (
    typeof documentId !== "string" ||
    typeof correlationId !== "string" ||
    typeof organizationId !== "string" ||
    typeof enqueuedAt !== "string"
  ) {
    return null;
  }
  return { documentId, correlationId, organizationId, enqueuedAt };
}

export async function pushRawToDlq(
  redis: RedisClient,
  rawMessage: string,
  reason: string,
): Promise<void> {
  const record = {
    rawMessage,
    reason,
    at: new Date().toISOString(),
  };
  await redis.lpush(REDIS_INGEST_DLQ_KEY, JSON.stringify(record));
}

export async function runIngestConsumerLoop(
  redis: RedisClient,
  options: {
    onJob: (job: ParsedIngestJob, raw: string) => Promise<void>;
    signal: AbortSignal;
  },
): Promise<void> {
  const { onJob, signal } = options;

  while (!signal.aborted) {
    let result: [string, string] | null;
    try {
      // BLPOP key timeoutSeconds — 0 blocks until an element is available.
      result = await redis.blpop(REDIS_INGEST_QUEUE_KEY, 0);
    } catch (e) {
      if (signal.aborted) break;
      console.error("[ingest-consumer] BLPOP error", e);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (!result || signal.aborted) continue;

    const [, payload] = result;
    const parsed = parseIngestPayload(payload);
    if (!parsed) {
      console.error(
        "[ingest-consumer] invalid JSON or shape; sending to DLQ",
        payload.slice(0, 200),
      );
      try {
        await pushRawToDlq(redis, payload, "invalid_json_or_shape");
      } catch (dlqErr) {
        console.error("[ingest-consumer] DLQ LPUSH failed", dlqErr);
      }
      continue;
    }

    try {
      await onJob(parsed, payload);
    } catch (err) {
      console.error("[ingest-consumer] onJob failed", parsed.documentId, err);
      try {
        await pushRawToDlq(
          redis,
          payload,
          err instanceof Error ? err.message : "onJob_failed",
        );
      } catch (dlqErr) {
        console.error("[ingest-consumer] DLQ LPUSH failed after onJob", dlqErr);
      }
    }
  }
}
