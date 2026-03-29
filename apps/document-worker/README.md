# Document worker (ingest queue consumer)

Long-running Node process that **consumes** document-ingest jobs from Upstash Redis.

## FIFO contract

- **Next.js** **RPUSH**es JSON payloads to the list `queue:ingest` (tail).
- This worker **BLPOP**s from the **same** list (head), so jobs run **oldest first**.

Key names must match `apps/web/src/lib/queue/redis-keys.ts`.

## Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `UPSTASH_REDIS_URL` | Yes | Redis **protocol** URL from Upstash (`rediss://…`), not the REST URL. |

Optional for later: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `TZ=UTC`.

## Run locally

From repo root:

```bash
pnpm --filter document-worker dev
```

Or from this directory after `pnpm install`:

```bash
pnpm dev
```

## Deploy

Run `pnpm build` then `pnpm start`, or use `tsx`/`node` against `src/index.ts` on Railway/Render with `UPSTASH_REDIS_URL` set.

Poison messages (invalid JSON or bad shape) are **LPUSH**ed to `queue:ingest:dlq` for inspection.
