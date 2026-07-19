import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrganizationStorageBytes } from "@/lib/storage/org-usage";
import { utcIsoNow } from "@/lib/datetime";
import { createDocumentIngestPayload } from "@/lib/queue/document-ingest-payload";
import { enqueueDocumentIngest } from "@/lib/queue/enqueue-document-ingest";
import {
    ALLOWED_CONTENT_TYPE,
    DOCUMENTS_BUCKET,
    MAX_ORG_STORAGE_BYTES,
    MAX_UPLOAD_BYTES,
    documentStoragePath,
} from "@/lib/documents/limits";

const COMPLETE_RATE_LIMIT = 30;
const COMPLETE_RATE_WINDOW_MS = 60_000;

/**
 * Finalizes an upload after the browser has PUT the file straight to Supabase Storage
 * (see resumable-upload.ts). Verifies the object actually landed at the expected path,
 * enforces size/type/quota server-side (the client's `register` inputs are advisory only),
 * inserts the `documents` row (status defaults to `pending`), and enqueues ingestion —
 * mirroring what the old single-request upload route did after `storage.upload()`.
 */
export async function POST(
    request: Request,
    context: { params: Promise<{ documentId: string }> },
) {
    try {
        // documentId comes from the route and must match the id `register` handed the client;
        // it also decides the storage path we verify below, so a missing value is a hard 400.
        const { documentId } = await context.params;
        if (!documentId) {
            return NextResponse.json({ error: "Missing document id" }, { status: 400 });
        }

        const supabase = await createClient();

        // Re-authenticate: `complete` is a separate request from `register`, so the session is
        // checked again rather than trusting anything carried over from the earlier call.
        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (!user || userError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Throttle per user, mirroring `register`, so the two-step flow can't be abused end-to-end.
        const rateLimit = checkRateLimit(
            `upload-complete:${user.id}`,
            COMPLETE_RATE_LIMIT,
            COMPLETE_RATE_WINDOW_MS,
        );
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Too many upload requests. Please slow down." },
                { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
            );
        }

        // Resolve the org from the session (not the request body) so we verify and insert against
        // the same org the file was allowed to land under; the storage path is derived from it.
        const { data: membership, error: membershipError } = await supabase
            .from("memberships")
            .select("organization_id")
            .eq("user_id", user.id)
            .single();

        if (membershipError || !membership) {
            return NextResponse.json(
                { error: "Organization not found" },
                { status: 400 },
            );
        }

        const organizationId = membership.organization_id;

        // Only the display name is accepted from the client here; size/type are re-derived from the
        // actual stored object below rather than trusted from the request.
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { name } = (body ?? {}) as { name?: unknown };
        if (typeof name !== "string" || name.trim().length === 0) {
            return NextResponse.json({ error: "Missing file name" }, { status: 400 });
        }

        // Recompute the expected location from org + id (never client input) so we verify exactly
        // where `register` told the browser to upload. objectName is the leaf within the org folder.
        const storagePath = documentStoragePath(organizationId, documentId);
        const objectName = `${documentId}.pdf`;

        // Storage has no SELECT policy for the `documents` bucket (see supabase/config + migrations),
        // so verifying the uploaded object requires the service role, same as open/delete routes.
        const service = createServiceRoleClient();
        if (!service) {
            return NextResponse.json(
                { error: "Server misconfigured: SUPABASE_SERVICE_ROLE_KEY is required to complete uploads" },
                { status: 503 },
            );
        }

        // Confirm the browser's direct upload actually produced an object at the expected path.
        // Without this, a client could call `complete` for a file it never successfully uploaded.
        const { data: listing, error: listError } = await service.storage
            .from(DOCUMENTS_BUCKET)
            .list(organizationId, { search: objectName, limit: 1 });

        if (listError) {
            console.error("Error verifying uploaded object", listError);
            return NextResponse.json(
                { error: "Could not verify the uploaded file" },
                { status: 500 },
            );
        }

        // `search` is a substring match, so pin to an exact filename match before trusting it.
        const uploaded = listing?.find((obj) => obj.name === objectName);
        if (!uploaded) {
            return NextResponse.json(
                { error: "Uploaded file not found. Upload may have failed or not finished." },
                { status: 404 },
            );
        }

        // Trust size/type from Storage's own metadata (what actually landed), not the client.
        const meta = uploaded.metadata as { size?: number; mimetype?: string } | null;
        const uploadedSize = typeof meta?.size === "number" ? meta.size : null;
        const uploadedMimetype = meta?.mimetype ?? null;

        // Defense in depth: the bucket's allowed_mime_types/file_size_limit already gate writes,
        // but re-check here in case bucket config drifts or the object was written another way.
        if (uploadedMimetype && uploadedMimetype !== ALLOWED_CONTENT_TYPE) {
            await service.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
            return NextResponse.json(
                { error: "Only PDF files are allowed" },
                { status: 400 },
            );
        }
        if (uploadedSize != null && uploadedSize > MAX_UPLOAD_BYTES) {
            await service.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
            return NextResponse.json(
                {
                    error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`,
                },
                { status: 413 },
            );
        }

        // Per-org storage quota (soft cap; Storage itself is the source of truth since no
        // byte-size column is tracked in Postgres today).
        try {
            const totalBytes = await getOrganizationStorageBytes(service, organizationId);
            if (totalBytes > MAX_ORG_STORAGE_BYTES) {
                await service.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
                return NextResponse.json(
                    { error: "Organization storage quota exceeded" },
                    { status: 413 },
                );
            }
        } catch (quotaError) {
            console.error("Error computing organization storage usage", quotaError);
            // Fail open on quota-check errors so a Storage listing hiccup doesn't block uploads.
        }

        // Only now — after the bytes are verified and within limits — is the DB row created, so a
        // failed/abandoned upload never leaves an orphaned `documents` row. correlationId ties this
        // row to its ingest job and structured logs across the web app and worker.
        const correlationId = uuidv4();

        const { data: document, error: insertError } = await supabase
            .from("documents")
            .insert({
                id: documentId,
                organization_id: organizationId,
                user_id: user.id,
                name: name.trim(),
                storage_path: storagePath,
                ingest_correlation_id: correlationId,
            })
            .select()
            .single();

        if (insertError) {
            console.error("Error inserting document", insertError);
            return NextResponse.json(
                { error: insertError.message },
                { status: 500 },
            );
        }

        // Enqueue ingestion, but don't fail the request if it doesn't land: the row is already
        // `pending`, so the reconcile cron can re-enqueue it later. Losing the job is recoverable;
        // losing the row is not.
        const ingestPayload = createDocumentIngestPayload(
            documentId,
            correlationId,
            organizationId,
        );
        const enqueueResult = await enqueueDocumentIngest(ingestPayload);
        if (!enqueueResult.ok) {
            if (enqueueResult.skipped) {
                console.warn(
                    "Upstash Redis not configured; ingest queue skipped (dev mode?)",
                    { documentId, enqueuedAt: utcIsoNow() },
                );
            } else {
                console.error(
                    "Document ingest enqueue failed after upload; document remains pending for reconciler",
                    { documentId, error: enqueueResult.error },
                );
            }
        }

        // Row exists and is queued (or will be reconciled): report success to the client.
        return NextResponse.json({
            success: true,
            document,
        });
    } catch (error) {
        console.error("Error completing document upload", error);
        return NextResponse.json(
            { error: "Error completing document upload" },
            { status: 500 },
        );
    }
}
