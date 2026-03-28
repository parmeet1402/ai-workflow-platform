import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only client with elevated privileges for Storage after app-level checks
 * (e.g. document row belongs to the user's organization). Never import in client code.
 */
export function createServiceRoleClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
