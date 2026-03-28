import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { v4 as uuidv4 } from "uuid";

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

        // 4. create path for storing
        const documentId = uuidv4()
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


        // 6. Add to documents table
        const { data: document, error: insertError } = await supabase
            .from("documents")
            .insert({
                id: documentId,
                organization_id: organizationId,
                user_id: user.id,
                name: file.name,
                storage_path: storagePath
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

        // 7. Success response
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