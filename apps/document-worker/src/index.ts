/**
 * Document ingest queue consumer: CAS claim, PDF extract, chunk, embed, transactional PG write.
 *
 * Keep static imports minimal: anything that loads before `startHealthServer()` resolves
 * can prevent Railway's HTTP healthcheck from ever seeing an open PORT.
 */
import "dotenv/config";
import http from "node:http";

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

/** Railway injects PORT; bind before loading OpenAI/ioredis/consumer so probes can succeed. */
function startHealthServer(): Promise<http.Server> {
  const port = httpListenPort();
  const server = http.createServer((req, res) => {
    // Single-purpose probe server: any GET/HEAD returns 200 (avoids path/proxy mismatches).
    if (req.method === "GET" || req.method === "HEAD") {
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
    // Omit host to use Node's default dual-stack bind (IPv4 + IPv6 where supported).
    server.listen(port, () => {
      server.removeListener("error", reject);
      console.log(
        JSON.stringify({
          stage: "health_listen",
          message: `HTTP health server listening on port ${port}`,
          port,
          envPort: process.env.PORT ?? null,
        }),
      );
      resolve(server);
    });
  });
}

async function main() {
  // stdout so hosts (e.g. Railway) don’t tag normal startup as [err] (stderr)
  console.log(
    JSON.stringify({
      stage: "boot",
      message: "document-worker process started",
      pid: process.pid,
    }),
  );
  const healthServer = await startHealthServer();

  const { loadConfig } = await import("./config.js");
  const { default: OpenAI } = await import("openai");
  const { Redis } = await import("ioredis");
  const { runIngestConsumerLoop } = await import("./consumer.js");
  const { runDocumentIngest } = await import(
    "./processor/run-document-ingest.js"
  );
  const { createSupabaseAdmin } = await import("./supabase/admin.js");

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(
      "Invalid worker configuration (set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY on the worker service):",
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
        // Managed Redis often resets long-lived TCP; log at most once per interval to avoid noise
        if (now - lastTransientRedisLog > 120_000) {
          lastTransientRedisLog = now;
          console.log(
            JSON.stringify({
              stage: "redis_transient_disconnect",
              message:
                "Redis TCP reset (expected on some hosts); client will reconnect",
              code: code ?? err.message,
            }),
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
      message: "Worker ready; consuming ingest queue",
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
