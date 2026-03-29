import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "documents";

/**
 * Downloads the PDF from Storage. Caller must have already claimed the document row
 * and validated org scope.
 */
export async function downloadDocumentPdf(
  supabase: SupabaseClient,
  storagePath: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(`Storage download failed: ${error.message}`);
  }
  if (!data) {
    throw new Error("Storage download returned empty body");
  }

  const ab = await data.arrayBuffer();
  if (ab.byteLength > maxBytes) {
    throw new Error(
      `PDF size ${ab.byteLength} exceeds limit ${maxBytes} bytes`,
    );
  }

  return new Uint8Array(ab);
}
