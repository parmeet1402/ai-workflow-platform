import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MIN_BUDGET = 1;
const MAX_BUDGET = 100_000_000;

function parseTokenBudget(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const budget = Math.floor(value);
  if (budget < MIN_BUDGET || budget > MAX_BUDGET) {
    return null;
  }
  return budget;
}

/** Current org settings (token budget). */
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

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, token_budget")
      .eq("id", membership.organization_id)
      .single();

    if (orgError || !org) {
      console.error("Error loading organization", orgError);
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        organizationId: org.id as string,
        tokenBudget: org.token_budget as number,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Error in GET /api/organization", error);
    return NextResponse.json(
      { error: "Error loading organization" },
      { status: 500 },
    );
  }
}

/** Update org settings (token budget). */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!user || userError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (body == null || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const tokenBudget = parseTokenBudget(
      (body as { tokenBudget?: unknown }).tokenBudget,
    );
    if (tokenBudget == null) {
      return NextResponse.json(
        {
          error: `tokenBudget must be an integer between ${MIN_BUDGET} and ${MAX_BUDGET}`,
        },
        { status: 400 },
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

    const { data: org, error: updateError } = await supabase
      .from("organizations")
      .update({ token_budget: tokenBudget })
      .eq("id", membership.organization_id)
      .select("id, token_budget")
      .single();

    if (updateError || !org) {
      console.error("Error updating organization token budget", updateError);
      return NextResponse.json(
        { error: "Error updating token budget" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      organizationId: org.id as string,
      tokenBudget: org.token_budget as number,
    });
  } catch (error) {
    console.error("Error in PATCH /api/organization", error);
    return NextResponse.json(
      { error: "Error updating organization" },
      { status: 500 },
    );
  }
}
