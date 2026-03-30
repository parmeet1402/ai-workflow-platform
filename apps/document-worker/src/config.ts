import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  WORKER_CONCURRENCY: z.string().optional(),
  MAX_PDF_BYTES: z.string().optional(),
  MAX_CHUNKS_PER_DOCUMENT: z.string().optional(),
  CHUNK_SIZE: z.string().optional(),
  CHUNK_OVERLAP: z.string().optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_DIMENSIONS: z.string().optional(),
});

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  openaiApiKey: string;
  workerConcurrency: number;
  maxPdfBytes: number;
  maxChunksPerDocument: number;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingDimensions: number;
};

function parseIntEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Railway/Vercel often expose only `NEXT_PUBLIC_SUPABASE_URL`; worker historically expected `SUPABASE_URL`.
 */
function resolvedSupabaseUrl(): string {
  return (
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ""
  );
}

export function loadConfig(): WorkerConfig {
  const e = envSchema.parse({
    ...process.env,
    SUPABASE_URL: resolvedSupabaseUrl(),
  });
  return {
    supabaseUrl: e.SUPABASE_URL.trim(),
    supabaseServiceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY.trim(),
    openaiApiKey: e.OPENAI_API_KEY.trim(),
    workerConcurrency: parseIntEnv(e.WORKER_CONCURRENCY, 1, 1, 16),
    maxPdfBytes: parseIntEnv(e.MAX_PDF_BYTES, 50 * 1024 * 1024, 1_000_000, 200 * 1024 * 1024),
    maxChunksPerDocument: parseIntEnv(e.MAX_CHUNKS_PER_DOCUMENT, 500, 1, 10_000),
    chunkSize: parseIntEnv(e.CHUNK_SIZE, 1500, 200, 32_000),
    chunkOverlap: parseIntEnv(e.CHUNK_OVERLAP, 200, 0, 8_000),
    embeddingModel: (e.EMBEDDING_MODEL ?? "text-embedding-3-small").trim(),
    embeddingDimensions: parseIntEnv(e.EMBEDDING_DIMENSIONS, 1536, 256, 3072),
  };
}
