/**
 * Document ingest queue consumer.
 */
import "dotenv/config";
import { Redis } from "ioredis";

import { runIngestConsumerLoop } from "./consumer.js";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = requireEnv("UPSTASH_REDIS_URL");

  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on("error", (err: Error) => {
    console.error("[document-worker] Redis connection error", err);
  });

  const controller = new AbortController();
  const shutdown = () => {
    console.info("[document-worker] shutdown signal");
    controller.abort();
    redis.disconnect();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.info(
    "[document-worker] Part 4 consumer started (BLPOP FIFO; pipeline stub until Part 5)",
  );

  await runIngestConsumerLoop(redis, {
    signal: controller.signal,
    onJob: async (job) => {
      console.info("[document-worker] received job", {
        documentId: job.documentId,
        correlationId: job.correlationId,
        organizationId: job.organizationId,
      });
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
