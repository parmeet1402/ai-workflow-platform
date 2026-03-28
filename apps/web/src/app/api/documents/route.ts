import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
    try {
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

        const { data: documents, error: documentsError } = await supabase
            .from("documents")
            .select("id, name, storage_path, user_id, organization_id, created_at")
            .eq("organization_id", organizationId)
            .order("created_at", { ascending: false, nullsFirst: false });

        if (documentsError) {
            console.error("Error listing documents", documentsError);
            return NextResponse.json(
                { error: documentsError.message },
                { status: 500 },
            );
        }

        return NextResponse.json(
            { documents: documents ?? [] },
            {
                headers: {
                    "Cache-Control": "private, no-store, max-age=0",
                },
            },
        );
    } catch (error) {
        console.error("Error listing documents", error);
        return NextResponse.json(
            { error: "Error listing documents" },
            { status: 500 },
        );
    }
}
