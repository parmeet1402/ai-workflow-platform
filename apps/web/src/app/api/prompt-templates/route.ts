import { NextResponse } from "next/server";
import {
  parseTemplateWriteBody,
  toPromptTemplate,
  type PromptTemplateRow,
} from "@/lib/chat/prompt-templates";
import { createClient } from "@/lib/supabase/server";

/** List prompt templates for the current org (shared by all members). */
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

    const organizationId = membership.organization_id as string;

    const { data: rows, error } = await supabase
      .from("prompt_templates")
      .select("id, name, body, updated_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error listing prompt templates", error);
      return NextResponse.json(
        { error: "Error listing prompt templates" },
        { status: 500 },
      );
    }

    const templates = (rows ?? []).map((row) =>
      toPromptTemplate(row as PromptTemplateRow),
    );

    return NextResponse.json(
      { templates },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/prompt-templates", error);
    return NextResponse.json(
      { error: "Error listing prompt templates" },
      { status: 500 },
    );
  }
}

/** Create a prompt template for the current org. */
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

    const organizationId = membership.organization_id as string;

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = parseTemplateWriteBody(json, "create");
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const body = parsed.body!;
    const name =
      parsed.name && parsed.name.length > 0
        ? parsed.name
        : body.slice(0, 40) || "Untitled template";

    const { data, error } = await supabase
      .from("prompt_templates")
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        name,
        body,
      })
      .select("id, name, body, updated_at")
      .single();

    if (error || !data) {
      console.error("Error creating prompt template", error);
      return NextResponse.json(
        { error: "Error creating prompt template" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { template: toPromptTemplate(data as PromptTemplateRow) },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error in POST /api/prompt-templates", error);
    return NextResponse.json(
      { error: "Error creating prompt template" },
      { status: 500 },
    );
  }
}
