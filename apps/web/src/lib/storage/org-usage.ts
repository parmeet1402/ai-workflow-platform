import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@/lib/documents/limits";

const LIST_PAGE_SIZE = 1000;

/**
 * Sums the byte size of every object under `{organizationId}/` in the `documents` bucket.
 * No `size` column is tracked in Postgres, so Storage itself is the source of truth for quota.
 */
export async function getOrganizationStorageBytes(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<number> {
  let total = 0;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .list(organizationId, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      throw new Error(`Storage list failed: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    for (const obj of data) {
      const size = (obj.metadata as { size?: number } | null)?.size;
      if (typeof size === "number") total += size;
    }

    if (data.length < LIST_PAGE_SIZE) break;
    offset += LIST_PAGE_SIZE;
  }

  return total;
}
