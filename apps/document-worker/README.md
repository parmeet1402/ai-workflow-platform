# Document worker (ingest queue consumer)

Long-running Node process that **consumes** document-ingest jobs from Upstash Redis, then:

1. **CAS-claims** the `documents` row (`pending` → `processing`).
2. **Downloads** the PDF from Supabase Storage (`documents` bucket).
3. **Extracts** text per page (`unpdf` / PDF.js).
4. **Chunks** with overlap; attaches `{ page }` in `metadata`.
5. **Embeds** with OpenAI (`text-embedding-3-small`, **1536** dims — must match `vector(1536)` in Postgres).
6. **Commits** in one transaction via RPC `worker_finalize_document_ingest` (delete old chunks, insert rows, set `ready`).

On failure after a successful claim, the worker calls `worker_fail_document_processing` so the row becomes `failed` with a short error (no DLQ for normal handled errors).

Apply the SQL migration in `supabase/migrations/20260329120000_document_ingest_pipeline.sql` before running this in production.

## FIFO contract

- **Next.js** **RPUSH**es JSON payloads to the list `queue:ingest` (tail).
- This worker **BLPOP**s from the **same** list (head), so jobs run **oldest first**.

Key names must match `apps/web/src/lib/queue/redis-keys.ts`.

## Environment

| Variable | Required | Notes |
|----------|----------|-------|
| `UPSTASH_REDIS_URL` | Yes | Redis **protocol** URL (`rediss://…`), not REST. |
| `SUPABASE_URL` | Yes | Same project as the web app. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role (bypasses RLS; Storage + RPC). |
| `OPENAI_API_KEY` | Yes | Embeddings only on the worker. |
| `WORKER_CONCURRENCY` | No | Parallel Redis consumers (default `1`, max `16`). |
| `MAX_PDF_BYTES` | No | Default 50 MiB. |
| `MAX_CHUNKS_PER_DOCUMENT` | No | Default 500. |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | No | Character windows (default 1500 / 200). |
| `EMBEDDING_MODEL` | No | Default `text-embedding-3-small`. |
| `EMBEDDING_DIMENSIONS` | No | Default **1536** (must match DB `vector(1536)`). |

Set `TZ=UTC` on the host if you want consistent `timestamp without time zone` semantics with Postgres.

## Run locally

From repo root:

```bash
pnpm --filter document-worker dev
```

## Docker

From monorepo root:

```bash
docker build -f apps/document-worker/Dockerfile -t document-worker .
docker run --env-file apps/document-worker/.env.local document-worker
```

## Deploy (Railway / Render)

Use repo root: install + `pnpm --filter document-worker build`, start `node apps/document-worker/dist/index.js` (or `pnpm --filter document-worker start`). Set all required env vars on the service.

Poison messages (invalid JSON) are still **LPUSH**ed to `queue:ingest:dlq` by the Redis consumer.
