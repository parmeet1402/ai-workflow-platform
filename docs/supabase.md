# Supabase (versioned)

The Supabase project is version-controlled in this repo under `supabase/`. Schema, functions, triggers, RLS policies, extensions, storage buckets, and auth config are described as files and applied with the Supabase CLI — **not** clicked into the dashboard. This lets database changes ship through PRs and be reproduced across environments.

The linked project is `khjtvhqknkjkoheczesx` (same as `NEXT_PUBLIC_SUPABASE_URL`). Both `apps/web` and `apps/document-worker` use it, so `supabase/` lives at the **repo root** (shared infrastructure, not owned by a single app).

---

## Directory layout

```
ai-workflow-platform/
├── supabase/
│   ├── config.toml              # project + auth + storage bucket config
│   ├── migrations/              # ordered SQL migrations (source of truth for schema)
│   │   └── 20260719150944_remote_schema.sql   # baseline snapshot of prod
│   └── .gitignore               # ignores .temp, signing_keys.json, .env*
├── apps/web/                    # Next.js app (Supabase consumer)
└── apps/document-worker/        # background worker (Supabase consumer)
```

`supabase/.temp/` is CLI machine state (linked project ref, cached versions) and is git-ignored.

---

## What is versioned

| Area | Where | Notes |
|------|-------|-------|
| Tables | `migrations/` | `organizations`, `memberships`, `profiles`, `documents`, `document_chunks` |
| Functions / RPCs | `migrations/` | `handle_new_user`, `worker_finalize_document_ingest`, `worker_fail_document_processing`, `rls_auto_enable` |
| Triggers | `migrations/` | `on_auth_user_created` on `auth.users` |
| RLS policies | `migrations/` | Org-scoped policies (RLS enabled on 5 tables) |
| Extensions | `migrations/` | `vector` (pgvector), `pgcrypto`, `uuid-ossp`, `supabase_vault`, `pg_stat_statements` |
| Storage bucket | `config.toml` → `[storage.buckets.documents]` | Private, PDF-only, 50 MiB cap |
| Auth settings | `config.toml` → `[auth]` | Site URL, redirect allow-list, email confirmation, etc. |

Not used (intentionally out of scope): Supabase Realtime, Edge Functions, Supabase Cron/Queues (background jobs run on Upstash Redis + a Railway worker instead).

---

## Prerequisites

- **Supabase CLI** (was set up with `2.109.1`). Check with `supabase --version`.
- **Docker** — required for the local stack and the shadow database used by `db diff` / `db pull`.
- Linked project + DB password (already linked; state in `supabase/.temp/`).

---

## Making a schema change (recommended: local-first)

Never edit the production schema by hand. Work against a local stack, generate a migration from the diff, verify it replays, then push.

1. **Start the local stack** (local Postgres seeded from all migrations):

```bash
supabase start
```

Studio is at `http://127.0.0.1:54323`.

2. **Make your change locally** via Studio or SQL until the local DB looks right. Do not hand-write the migration yet.

3. **Generate the migration from the diff:**

```bash
supabase db diff -f <descriptive_name>
# → supabase/migrations/<timestamp>_<descriptive_name>.sql
```

4. **Verify it replays cleanly from scratch:**

```bash
supabase db reset   # wipes local DB, re-applies every migration in order
```

If the app still works against the reset DB, the migration is self-consistent.

5. **Commit the migration file and open a PR.**

6. **Apply to production** (only un-applied migrations run; the baseline is already marked applied):

```bash
supabase db push
```

---

## Alternative: quick change against the remote

For a small change without running Docker, edit the schema on the remote (SQL editor / `psql`), then capture the delta into a migration:

```bash
supabase db pull -f <descriptive_name>
```

Commit the generated file. The local-first loop is preferred because `db reset` proves the migrations are consistent; this shortcut skips that check.

---

## Auth / Storage config changes

These live in `config.toml`, not in migrations. After editing `[auth]` or `[storage.buckets.*]`:

```bash
supabase config push
```

> **Warning:** `config push` sends this file's values to the hosted project. `site_url` in `config.toml` is the **local** URL (`http://127.0.0.1:3000`). Before pushing, either change `site_url` to the production URL (`https://ai-workflow-platform-web.vercel.app`) or keep managing the Site URL in the dashboard. `additional_redirect_urls` already contains both local and prod callbacks and is safe to push. Email confirmation is off in both environments (`[auth.email].enable_confirmations = false`).

---

## Keeping the repo and production in sync

Confirm there is no drift between the committed migrations and the live database:

```bash
supabase db diff --linked
# Expected: "No schema changes found"
```

Run this after linking a fresh clone, before a release, or whenever you suspect someone changed the dashboard directly. A non-empty result means the dashboard drifted — capture it with `supabase db pull -f <name>` and commit.

---

## Gotchas (things this project already hit)

- **Do not make schema/auth/storage changes in the dashboard.** They drift from the repo and break the next `db diff` / `db push`.
- **Do not `Ctrl+C` during "Creating shadow database…".** It orphans a Postgres container holding port `54320`, causing `Bind for 0.0.0.0:54320 failed: port is already allocated` on the next run. Clean up with:

```bash
docker rm -f $(docker ps -q --filter ancestor=public.ecr.aws/supabase/postgres:17.6.1.084)
```

- **Keep `[experimental.pgdelta] enabled = false`.** On the CLI version in use, pgdelta returns "No schema changes found" on an initial `db pull` and writes nothing (Supabase CLI issue #5826). The legacy `migra` engine works correctly.
- The `WARNING (01007): no privileges were granted for "vector_*"` lines during a pull are harmless pgvector ownership notices from the shadow-DB restore.
- **Never hand-invent migration filenames.** Use `supabase db diff -f <name>` or `supabase migration new <name>` so the timestamp format is correct.
- If a pull reports the schema written but fails with `LegacyDbPullWriteError: failed to update migration table`, the file is fine — reconcile the remote history with `supabase migration repair --status applied <version>`.

---

## Follow-up hardening (not yet done)

- `handle_new_user()` is a `SECURITY DEFINER` function in the exposed `public` schema. Supabase security guidance recommends keeping `security definer` functions out of exposed schemas; consider relocating it to a private schema in a future migration.

---

## Command reference

| Task | Command |
|------|---------|
| Start / stop local stack | `supabase start` / `supabase stop` |
| New empty migration | `supabase migration new <name>` |
| Generate migration from local changes | `supabase db diff -f <name>` |
| Re-apply all migrations locally | `supabase db reset` |
| Apply migrations to prod | `supabase db push` |
| Capture remote changes into a migration | `supabase db pull -f <name>` |
| Push auth/storage config to prod | `supabase config push` |
| Check for drift vs prod | `supabase db diff --linked` |
| List migration history | `supabase migration list` |
| Reconcile remote history | `supabase migration repair --status applied <version>` |
