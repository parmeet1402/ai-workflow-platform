import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { utcIsoNow } from "@/lib/datetime";
import { createDocumentIngestPayload } from "@/lib/queue/document-ingest-payload";
import { enqueueDocumentIngest } from "@/lib/queue/enqueue-document-ingest";
import { v4 as uuidv4 } from "uuid";

/**
 * PDF upload: Storage + DB row, then enqueue a background-ingest job to Redis (Upstash).
 * Heavy work (extract, chunk, embed) runs in a separate worker process, not in this request.
 */
export async function POST(request: Request) {
    try {
        // 0. create supabase client
        const supabase = await createClient();

        // 1. get logged in user
        const {
            data: { user },
            error: userError
        } = await supabase.auth.getUser()

        if (!user || userError) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 }
            )
        }

        // 2. get user's organization
        const { data: membership, error: membershipError } = await supabase
            .from("memberships")
            .select("organization_id")
            .eq("user_id", user.id)
            .single()

        if (membershipError || !membership) {
            return NextResponse.json(
                { error: "Organization not found" },
                { status: 400 }
            )
        }

        const organizationId = membership.organization_id

        // 3. extract file from request body
        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json(
                { error: "No file provided" },
                { status: 400 }
            )
        }

        if (file.type !== "application/pdf") {
            return NextResponse.json(
                { error: "Only PDF files are allowed" },
                { status: 400 }
            )
        }

        const fileBuffer = await file.arrayBuffer()

        // 4. Ids: document row id + correlation id for logs / queue payload (stored on the row too).
        const documentId = uuidv4()
        const correlationId = uuidv4()
        const storagePath = `${organizationId}/${documentId}.pdf`

        // 5. Save extracted file to the path
        const { error: uploadError } = await supabase.storage
            .from("documents")
            .upload(storagePath, fileBuffer, {
                contentType: "application/pdf"
            })

        if (uploadError) {
            console.error("Error uploading document", uploadError);
            return NextResponse.json(
                { error: uploadError.message },
                { status: 500 }
            )
        }


        // 6. Persist metadata; default processing_status = pending (DB). Worker will flip to processing/ready/failed.
        const { data: document, error: insertError } = await supabase
            .from("documents")
            .insert({
                id: documentId,
                organization_id: organizationId,
                user_id: user.id,
                name: file.name,
                storage_path: storagePath,
                ingest_correlation_id: correlationId,
            })
            .select()
            .single()

        if (insertError) {
            console.error("Error inserting document", insertError);
            return NextResponse.json(
                { error: insertError.message },
                { status: 500 }
            )
        }

        // 7. Notify the worker via Redis: RPUSH JSON onto `queue:ingest` (see enqueue-document-ingest.ts).
        const ingestPayload = createDocumentIngestPayload(
            documentId,
            correlationId,
            organizationId,
        )
        const enqueueResult = await enqueueDocumentIngest(ingestPayload)
        if (!enqueueResult.ok) {
            if (enqueueResult.skipped) {
                console.warn(
                    "Upstash Redis not configured; ingest queue skipped (dev mode?)",
                    { documentId, enqueuedAt: utcIsoNow() },
                )
            } else {
                console.error(
                    "Document ingest enqueue failed after upload; document remains pending for reconciler",
                    { documentId, error: enqueueResult.error },
                )
            }
        }

        // 8. Always return 200 if the file + row succeeded; enqueue failure is logged (reconciler can retry).
        return NextResponse.json({
            success: true,
            document
        })
    } catch (error) {
        console.error("Error uploading documents", error)

        return NextResponse.json(
            { error: "Error uploading documents" },
            { status: 500 }
        )
    }
}