/**
 * Shared upload limits for the direct-to-Storage flow (register -> TUS upload -> complete).
 *
 * These are advisory on the client and in `register` (fast-fail UX); the bucket's own
 * `file_size_limit` / `allowed_mime_types` (see `supabase/config.toml`) and the worker's
 * `MAX_PDF_BYTES` remain the authoritative enforcement points. Keep all three aligned.
 */

function parseByteEnv(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Must stay <= the Storage bucket's `file_size_limit` in `supabase/config.toml`. */
export const MAX_UPLOAD_BYTES = parseByteEnv(
  process.env.MAX_UPLOAD_BYTES,
  50 * 1024 * 1024,
);

/** Soft per-organization cap on total bytes stored, checked at `complete` time. */
export const MAX_ORG_STORAGE_BYTES = parseByteEnv(
  process.env.MAX_ORG_STORAGE_BYTES,
  5 * 1024 * 1024 * 1024,
);

export const ALLOWED_CONTENT_TYPE = "application/pdf";

export const DOCUMENTS_BUCKET = "documents";

export function documentStoragePath(
  organizationId: string,
  documentId: string,
): string {
  return `${organizationId}/${documentId}.pdf`;
}
