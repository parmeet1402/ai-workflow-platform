/**
 * TCP consumer for Upstash Redis. Uses **BLPOP** on the ingest list head so jobs
 * enqueued with **RPUSH** on the Next.js side are processed FIFO.
 */
import type { Redis as RedisClient } from "ioredis";

import { REDIS_INGEST_DLQ_KEY, REDIS_INGEST_QUEUE_KEY } from "./redis-keys.js";

/**
 * Block at most this many seconds waiting for a job, then retry BLPOP.
 * Infinite BLPOP (0) keeps one TCP session open indefinitely; proxies in front
 * of managed Redis (e.g. Upstash) often reset idle connections — periodic
 * wakeups avoid ECONNRESET storms while preserving FIFO when the queue is busy.
 */
const BLPOP_BLOCK_SECONDS = 55;

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
  let lastWaitLogAt = 0;

  while (!signal.aborted) {
    let result: [string, string] | null;
    try {
      const now = Date.now();
      if (now - lastWaitLogAt > 10_000) {
        lastWaitLogAt = now;
        let queueLen: number | null = null;
        try {
          queueLen = await redis.llen(REDIS_INGEST_QUEUE_KEY);
        } catch {
          // ignore; queueLen is only for debugging
        }
        console.log(
          JSON.stringify({
            stage: "ingest_waiting",
            message: "waiting on BLPOP",
            queue: REDIS_INGEST_QUEUE_KEY,
            queueLen,
          }),
        );
      }
      // BLPOP key timeoutSeconds — bounded block so long-lived idle TCP is rare.
      result = await redis.blpop(REDIS_INGEST_QUEUE_KEY, BLPOP_BLOCK_SECONDS);
    } catch (e) {
      if (signal.aborted) break;
      console.error("[ingest-consumer] BLPOP error", e);
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    if (!result || signal.aborted) continue;

    const [, payload] = result;
    console.log(
      JSON.stringify({
        stage: "ingest_blpop_hit",
        message: "BLPOP returned a payload",
        queue: REDIS_INGEST_QUEUE_KEY,
        payloadBytes: payload.length,
      }),
    );
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
      console.log(
        JSON.stringify({
          stage: "ingest_parsed_job",
          documentId: parsed.documentId,
          correlationId: parsed.correlationId,
          organizationId: parsed.organizationId,
        }),
      );
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
