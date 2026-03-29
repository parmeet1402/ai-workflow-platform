/**
 * Document ingest queue consumer: CAS claim, PDF extract, chunk, embed, transactional PG write.
 */
import "dotenv/config";
import OpenAI from "openai";
import { Redis } from "ioredis";

import { loadConfig } from "./config.js";
import { runIngestConsumerLoop } from "./consumer.js";
import { runDocumentIngest } from "./processor/run-document-ingest.js";
import { createSupabaseAdmin } from "./supabase/admin.js";

function requireRedisUrl(): string {
  const v = process.env.UPSTASH_REDIS_URL?.trim();
  if (!v) {
    console.error("Missing required env: UPSTASH_REDIS_URL");
    process.exit(1);
  }
  return v;
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(
      "Invalid worker configuration (check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY):",
      e,
    );
    process.exit(1);
  }

  const redisUrl = requireRedisUrl();
  const supabase = createSupabaseAdmin(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
  );
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const n = config.workerConcurrency;
  const redises = Array.from(
    { length: n },
    () =>
      new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        // Helps some networks keep the TLS/TCP session from looking fully idle.
        keepAlive: 10_000,
      }),
  );

  let lastTransientRedisLog = 0;
  for (const r of redises) {
    r.on("error", (err: Error & { code?: string }) => {
      const code = err.code;
      const transient =
        code === "ECONNRESET" || code === "EPIPE" || code === "ETIMEDOUT";
      if (transient) {
        const now = Date.now();
        if (now - lastTransientRedisLog > 30_000) {
          lastTransientRedisLog = now;
          console.error(
            "[document-worker] Redis connection dropped (reconnecting):",
            code ?? err.message,
          );
        }
        return;
      }
      console.error("[document-worker] Redis connection error", err);
    });
  }

  const controller = new AbortController();
  const shutdown = () => {
    console.info("[document-worker] shutdown signal");
    controller.abort();
    for (const r of redises) {
      r.disconnect();
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(
    JSON.stringify({
      stage: "startup",
      workerConcurrency: n,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
    }),
  );

  await Promise.all(
    redises.map((redis) =>
      runIngestConsumerLoop(redis, {
        signal: controller.signal,
        onJob: async (job) => {
          await runDocumentIngest(supabase, openai, config, job);
        },
      }),
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
