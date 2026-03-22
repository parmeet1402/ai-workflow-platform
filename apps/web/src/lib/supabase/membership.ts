import type { SupabaseClient } from "@supabase/supabase-js";

/** Membership row plus org display name from `organizations` via FK. */
export type MembershipWithOrg = {
  organization_id: string;
  role: string;
  organizationName: string | null;
};

type MembershipJoinRow = {
  organization_id: string;
  role: string;
  organizations: { name: string } | { name: string }[] | null;
};

function orgNameFromJoin(
  organizations: MembershipJoinRow["organizations"]
): string | null {
  if (!organizations) return null;
  if (Array.isArray(organizations)) return organizations[0]?.name ?? null;
  return organizations.name ?? null;
}

export async function getMembershipForUser(
  supabase: SupabaseClient,
  userId: string
): Promise<MembershipWithOrg | null> {
  // maybeSingle: no row → null; use .single() instead if a row is required and should error otherwise.
  // Requires FK from memberships.organization_id → organizations.id (embed name must match Supabase schema).
  const { data, error } = await supabase
    .from("memberships")
    .select("organization_id, role, organizations(name)")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as MembershipJoinRow;
  return {
    organization_id: row.organization_id,
    role: row.role,
    organizationName: orgNameFromJoin(row.organizations),
  };
}
