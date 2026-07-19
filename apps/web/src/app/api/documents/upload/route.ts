import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import {
    ALLOWED_CONTENT_TYPE,
    DOCUMENTS_BUCKET,
    MAX_UPLOAD_BYTES,
    documentStoragePath,
} from "@/lib/documents/limits";

const REGISTER_RATE_LIMIT = 30;
const REGISTER_RATE_WINDOW_MS = 60_000;

/**
 * Registers an upload: authenticates the user, resolves their organization, and hands back
 * a server-chosen storage path for a **new** document id. No file bytes are sent to this route;
 * the browser uploads directly to Supabase Storage afterward (see resumable-upload.ts), then
 * calls `POST /api/documents/:documentId/complete` to persist metadata and enqueue ingestion.
 *
 * Keeping bytes off this route removes the ~4.5MB platform body-size ceiling and keeps this
 * endpoint a small, typed JSON API that a future Python backend could sit behind unchanged.
 */
export async function POST(request: Request) {
    try {
        const supabase = await createClient();

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (!user || userError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const rateLimit = checkRateLimit(
            `upload-register:${user.id}`,
            REGISTER_RATE_LIMIT,
            REGISTER_RATE_WINDOW_MS,
        );
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: "Too many upload requests. Please slow down." },
                { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
            );
        }

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

        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const { name, size, contentType } = (body ?? {}) as {
            name?: unknown;
            size?: unknown;
            contentType?: unknown;
        };

        if (typeof name !== "string" || name.trim().length === 0) {
            return NextResponse.json({ error: "Missing file name" }, { status: 400 });
        }
        if (typeof contentType !== "string" || contentType !== ALLOWED_CONTENT_TYPE) {
            return NextResponse.json(
                { error: "Only PDF files are allowed" },
                { status: 400 },
            );
        }
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
            return NextResponse.json({ error: "Missing or invalid file size" }, { status: 400 });
        }
        // Advisory: the real gate is the Storage bucket's file_size_limit. This just fails fast.
        if (size > MAX_UPLOAD_BYTES) {
            return NextResponse.json(
                {
                    error: `File exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB upload limit`,
                },
                { status: 413 },
            );
        }

        // Server-generated id + org-derived path: the client never chooses where its file lands.
        const documentId = uuidv4();
        const storagePath = documentStoragePath(organizationId, documentId);

        return NextResponse.json({
            documentId,
            bucket: DOCUMENTS_BUCKET,
            storagePath,
            name: name.trim(),
        });
    } catch (error) {
        console.error("Error registering document upload", error);
        return NextResponse.json(
            { error: "Error registering document upload" },
            { status: 500 },
        );
    }
}
