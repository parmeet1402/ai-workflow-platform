import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function DELETE(
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

        const service = createServiceRoleClient();
        const storageClient = service ?? supabase;

        const { error: removeError } = await storageClient.storage
            .from("documents")
            .remove([storagePath]);

        if (removeError) {
            console.error("Error removing document from storage", removeError);
            const hint =
                !service && removeError.message?.toLowerCase().includes("not found")
                    ? " Add SUPABASE_SERVICE_ROLE_KEY to your server env if Storage policies block deletes."
                    : "";
            return NextResponse.json(
                {
                    error: `${removeError.message ?? "Could not delete document file"}${hint}`,
                },
                { status: 500 },
            );
        }

        // Prefer service role for the row delete when available: RLS may allow
        // select/insert but not delete, which otherwise returns no error and 0 rows.
        const dbClient = service ?? supabase;
        const { data: deletedRows, error: deleteError } = await dbClient
            .from("documents")
            .delete()
            .eq("id", documentId)
            .eq("organization_id", organizationId)
            .select("id");

        if (deleteError) {
            console.error("Error deleting document row", deleteError);
            return NextResponse.json(
                { error: deleteError.message },
                { status: 500 },
            );
        }

        if (!deletedRows?.length) {
            return NextResponse.json(
                {
                    error:
                        "Document row was not removed. Add SUPABASE_SERVICE_ROLE_KEY or allow DELETE on `documents` for your org in Supabase RLS.",
                },
                { status: 500 },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error deleting document", error);
        return NextResponse.json(
            { error: "Error deleting document" },
            { status: 500 },
        );
    }
}
