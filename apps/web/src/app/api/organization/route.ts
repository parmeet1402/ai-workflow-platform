import { NextResponse } from "next/server";
import { canAdjustSystemPrompt } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const MIN_BUDGET = 1;
const MAX_BUDGET = 100_000_000;
const MAX_SYSTEM_PROMPT_CHARS = 8_000;

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

/**
 * Parse optional systemPrompt for PATCH.
 * - omitted → undefined (no update)
 * - null / "" / whitespace → null (reset to built-in)
 * - non-empty string → trimmed value
 */
function parseSystemPromptPatch(
  body: Record<string, unknown>,
): string | null | undefined | { error: string } {
  if (!("systemPrompt" in body)) {
    return undefined;
  }
  const raw = body.systemPrompt;
  if (raw == null) {
    return null;
  }
  if (typeof raw !== "string") {
    return { error: "systemPrompt must be a string or null" };
  }
  const trimmed = raw.trim();
  if (trimmed.length > MAX_SYSTEM_PROMPT_CHARS) {
    return {
      error: `systemPrompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters`,
    };
  }
  return trimmed.length > 0 ? trimmed : null;
}

type OrgRow = {
  id: string;
  token_budget: number;
  system_prompt: string | null;
};

function orgJson(org: OrgRow) {
  return {
    organizationId: org.id,
    tokenBudget: org.token_budget,
    systemPrompt: org.system_prompt,
  };
}

/** Current org settings (token budget + system prompt). */
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
      .select("id, token_budget, system_prompt")
      .eq("id", membership.organization_id)
      .single();

    if (orgError || !org) {
      console.error("Error loading organization", orgError);
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 },
      );
    }

    return NextResponse.json(orgJson(org as OrgRow), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Error in GET /api/organization", error);
    return NextResponse.json(
      { error: "Error loading organization" },
      { status: 500 },
    );
  }
}

/** Update org settings (token budget and/or system prompt). */
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

    const record = body as Record<string, unknown>;
    const hasTokenBudget = "tokenBudget" in record;
    const systemPromptResult = parseSystemPromptPatch(record);

    if (
      systemPromptResult &&
      typeof systemPromptResult === "object" &&
      "error" in systemPromptResult
    ) {
      return NextResponse.json(
        { error: systemPromptResult.error },
        { status: 400 },
      );
    }

    const systemPrompt =
      systemPromptResult === undefined
        ? undefined
        : (systemPromptResult as string | null);

    let tokenBudget: number | undefined;
    if (hasTokenBudget) {
      const parsed = parseTokenBudget(record.tokenBudget);
      if (parsed == null) {
        return NextResponse.json(
          {
            error: `tokenBudget must be an integer between ${MIN_BUDGET} and ${MAX_BUDGET}`,
          },
          { status: 400 },
        );
      }
      tokenBudget = parsed;
    }

    if (tokenBudget === undefined && systemPrompt === undefined) {
      return NextResponse.json(
        { error: "Provide tokenBudget and/or systemPrompt" },
        { status: 400 },
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 400 },
      );
    }

    const membershipRole =
      typeof membership.role === "string" ? membership.role : null;

    if (
      systemPrompt !== undefined &&
      !canAdjustSystemPrompt(membershipRole)
    ) {
      return NextResponse.json(
        { error: "Only organization owners can set a custom system prompt" },
        { status: 403 },
      );
    }

    const update: { token_budget?: number; system_prompt?: string | null } = {};
    if (tokenBudget !== undefined) {
      update.token_budget = tokenBudget;
    }
    if (systemPrompt !== undefined) {
      update.system_prompt = systemPrompt;
    }

    const { data: org, error: updateError } = await supabase
      .from("organizations")
      .update(update)
      .eq("id", membership.organization_id)
      .select("id, token_budget, system_prompt")
      .single();

    if (updateError || !org) {
      console.error("Error updating organization", updateError);
      return NextResponse.json(
        { error: "Error updating organization" },
        { status: 500 },
      );
    }

    return NextResponse.json(orgJson(org as OrgRow));
  } catch (error) {
    console.error("Error in PATCH /api/organization", error);
    return NextResponse.json(
      { error: "Error updating organization" },
      { status: 500 },
    );
  }
}
