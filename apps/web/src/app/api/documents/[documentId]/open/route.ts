import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const SIGNED_URL_TTL_SECONDS = 3600;

export async function GET(
    _request: Request,
    context: { params: Promise<{ documentId: string }> },
) {
    try {
        const { documentId } = await context.params;

        if (!documentId) {
            return NextResponse.json({ error: "Missing document id" }, { status: 400 });
        }

        const supabase = await createClient();

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser();

        if (!user || userError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

        const { data: row, error: rowError } = await supabase
            .from("documents")
            .select("id, organization_id, storage_path")
            .eq("id", documentId)
            .single();

        if (rowError || !row) {
            return NextResponse.json({ error: "Document not found" }, { status: 404 });
        }

        if (row.organization_id !== organizationId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const storagePath = row.storage_path?.trim();
        if (!storagePath) {
            return NextResponse.json(
                { error: "Document has no storage path" },
                { status: 500 },
            );
        }

        // Prefer service role: Storage RLS often blocks `createSignedUrl` for the user JWT,
        // which surfaces as "Object not found" even when the file exists.
        const service = createServiceRoleClient();
        const storageClient = service ?? supabase;

        const { data: signed, error: signError } = await storageClient.storage
            .from("documents")
            .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

        if (signError || !signed?.signedUrl) {
            console.error("Error creating signed URL", signError);
            const hint =
                !service && signError?.message?.toLowerCase().includes("not found")
                    ? " Add SUPABASE_SERVICE_ROLE_KEY to your server env if Storage read policies block signed URLs."
                    : "";
            return NextResponse.json(
                {
                    error: `${signError?.message ?? "Could not open document"}${hint}`,
                },
                { status: 500 },
            );
        }

        return NextResponse.redirect(signed.signedUrl);
    } catch (error) {
        console.error("Error opening document", error);
        return NextResponse.json(
            { error: "Error opening document" },
            { status: 500 },
        );
    }
}
