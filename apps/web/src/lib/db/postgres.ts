import postgres from "postgres";

/**
 * Server-only Postgres client for chat retrieval (pgvector KNN).
 * Uses DATABASE_URL (Supabase direct or pooler URI). Never import from client code.
 */
let sql: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (sql) return sql;

  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  // prepare: false — required for Supabase transaction-mode pooler (PgBouncer).
  // max: 1 — keep connection count low on serverless.
  sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return sql;
}
