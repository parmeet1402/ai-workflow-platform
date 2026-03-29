import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";

import {
  createDocumentIngestPayload,
} from "@/lib/queue/document-ingest-payload";
import {
  enqueueDocumentIngest,
  isUpstashRedisConfigured,
  tryAcquireReconcileLock,
} from "@/lib/queue/enqueue-document-ingest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Recovery path when upload succeeded in Postgres but Redis RPUSH failed (or the message was lost).
 *
 * - **Auth:** `Authorization: Bearer <CRON_SECRET>` — same value as the `CRON_SECRET` env var
 *   (Vercel Cron sends this automatically when the var is set).
 * - **Query:** `minAgeMinutes` (default 5) — only rows older than that are considered, so brand-new
 *   uploads are not immediately duplicated while the first RPUSH might still be in flight.
 * - **Flow:** find `pending` documents → optional Redis lock per id → same RPUSH as upload
 *   (`enqueueDocumentIngest`). Lock avoids duplicate jobs if two schedulers overlap.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization");
  const bearer =
    auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
  if (bearer !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Service role: must read `documents` across all orgs (no end-user session in a cron call).
  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 503 },
    );
  }

  if (!isUpstashRedisConfigured()) {
    return NextResponse.json(
      { error: "Upstash Redis is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const minAgeMinutes = Math.max(
    1,
    Number.parseInt(url.searchParams.get("minAgeMinutes") ?? "5", 10) || 5,
  );

  const thresholdIso = new Date(
    Date.now() - minAgeMinutes * 60 * 1000,
  ).toISOString();

  // Stale = still pending and created long enough ago that a normal enqueue should have run.
  const { data: rows, error } = await supabase
    .from("documents")
    .select("id, organization_id, ingest_correlation_id")
    .eq("processing_status", "pending")
    .lt("created_at", thresholdIso);

  if (error) {
    console.error("reconcile-ingest: query failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let requeued = 0;
  let skippedLocks = 0;
  let enqueueFailed = 0;

  for (const row of rows ?? []) {
    const documentId = row.id;
    const organizationId = row.organization_id;
    if (!organizationId) continue;

    // Skip if another reconcile run (or process) already holds the lock for this document id.
    const lockOk = await tryAcquireReconcileLock(documentId);
    if (!lockOk) {
      skippedLocks += 1;
      continue;
    }

    const correlationId = row.ingest_correlation_id ?? uuidv4();
    const payload = createDocumentIngestPayload(
      documentId,
      correlationId,
      organizationId,
    );

    const result = await enqueueDocumentIngest(payload);
    if (result.ok) {
      requeued += 1;
    } else {
      enqueueFailed += 1;
      console.error(
        "reconcile-ingest: enqueue failed",
        documentId,
        result.error,
      );
    }
  }

  return NextResponse.json({
    scanned: rows?.length ?? 0,
    requeued,
    skippedLocks,
    enqueueFailed,
    minAgeMinutes,
  });
}
