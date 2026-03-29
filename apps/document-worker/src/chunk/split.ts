import type { PageText } from "../extract/pdf.js";

export type TextChunk = {
  text: string;
  metadata: { page: number };
};

/**
 * Character windows with overlap, tagged with the PDF page the text came from.
 */
export function chunkPages(
  pages: PageText[],
  chunkSize: number,
  overlap: number,
  maxChunks: number,
): TextChunk[] {
  if (overlap >= chunkSize) {
    throw new Error("CHUNK_OVERLAP must be less than CHUNK_SIZE");
  }

  const out: TextChunk[] = [];

  for (const { page, text } of pages) {
    if (text.length === 0) continue;

    let start = 0;
    while (start < text.length) {
      if (out.length >= maxChunks) {
        throw new Error(`Exceeded MAX_CHUNKS_PER_DOCUMENT (${maxChunks})`);
      }

      const end = Math.min(start + chunkSize, text.length);
      const slice = text.slice(start, end).trim();
      if (slice.length > 0) {
        out.push({ text: slice, metadata: { page } });
      }

      if (end >= text.length) break;
      start = end - overlap;
      if (start <= 0) start = end;
    }
  }

  return out;
}
