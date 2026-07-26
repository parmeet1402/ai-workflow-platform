import { NextResponse } from "next/server";
import {
  parseTemplateWriteBody,
  toPromptTemplate,
  type PromptTemplateRow,
} from "@/lib/chat/prompt-templates";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AuthOk = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  organizationId: string;
};

async function requireOrgMember(): Promise<
  AuthOk | { response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (!user || userError) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();

  if (membershipError || !membership) {
    return {
      response: NextResponse.json(
        { error: "Organization not found" },
        { status: 400 },
      ),
    };
  }

  return {
    supabase,
    organizationId: membership.organization_id as string,
  };
}

/** Update a prompt template in the current org. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const auth = await requireOrgMember();
    if ("response" in auth) {
      return auth.response;
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = parseTemplateWriteBody(json, "update");
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const patch: {
      name?: string;
      body?: string;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };
    if (parsed.name !== undefined) {
      patch.name =
        parsed.name.length > 0 ? parsed.name : "Untitled template";
    }
    if (parsed.body !== undefined) {
      patch.body = parsed.body;
    }

    const { data, error } = await auth.supabase
      .from("prompt_templates")
      .update(patch)
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .select("id, name, body, updated_at")
      .maybeSingle();

    if (error) {
      console.error("Error updating prompt template", error);
      return NextResponse.json(
        { error: "Error updating prompt template" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Prompt template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      template: toPromptTemplate(data as PromptTemplateRow),
    });
  } catch (error) {
    console.error("Error in PATCH /api/prompt-templates/[id]", error);
    return NextResponse.json(
      { error: "Error updating prompt template" },
      { status: 500 },
    );
  }
}

/** Delete a prompt template in the current org. */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const auth = await requireOrgMember();
    if ("response" in auth) {
      return auth.response;
    }

    const { data, error } = await auth.supabase
      .from("prompt_templates")
      .delete()
      .eq("id", id)
      .eq("organization_id", auth.organizationId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Error deleting prompt template", error);
      return NextResponse.json(
        { error: "Error deleting prompt template" },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Prompt template not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error in DELETE /api/prompt-templates/[id]", error);
    return NextResponse.json(
      { error: "Error deleting prompt template" },
      { status: 500 },
    );
  }
}
