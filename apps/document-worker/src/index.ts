/**
 * Document ingest queue consumer: CAS claim, PDF extract, chunk, embed, transactional PG write.
 */
import "dotenv/config";
import http from "node:http";
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

function httpListenPort(): number {
  const raw = process.env.PORT;
  if (raw == null || String(raw).trim() === "") {
    return 8787;
  }
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65_535) {
    console.error("[document-worker] Invalid PORT:", raw);
    process.exit(1);
  }
  return n;
}

/** Railway injects PORT; the process must listen before HTTP health checks pass. */
function startHealthServer(): Promise<http.Server> {
  const port = httpListenPort();
  const server = http.createServer((req, res) => {
    const pathOnly = req.url?.split("?")[0] ?? "";
    const ok =
      pathOnly === "/" ||
      pathOnly === "/health" ||
      pathOnly === "/healthz";
    if (
      ok &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      if (req.method === "GET") res.end("ok");
      else res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.removeListener("error", reject);
      console.log(
        JSON.stringify({ stage: "health_listen", port, bind: "0.0.0.0" }),
      );
      resolve(server);
    });
  });
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

  const healthServer = await startHealthServer();

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
    healthServer.close();
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
