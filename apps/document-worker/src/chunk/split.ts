import type { PageText } from "../extract/pdf.js";

export type TextChunk = {
  text: string;
  metadata: { page: number };
};

export type ChunkPagesResult = {
  chunks: TextChunk[];
  /** True when the document had more chunks than `maxChunks`; remaining text was dropped. */
  truncated: boolean;
};

/**
 * Character windows with overlap, tagged with the PDF page the text came from.
 *
 * Large documents are truncated at `maxChunks` rather than failing the whole ingest: a
 * partially-indexed document (with `truncated: true` surfaced by the caller) is more useful
 * than a `failed` one, and the cap exists to bound worker memory/time and RPC payload size.
 */
export function chunkPages(
  pages: PageText[],
  chunkSize: number,
  overlap: number,
  maxChunks: number,
): ChunkPagesResult {
  if (overlap >= chunkSize) {
    throw new Error("CHUNK_OVERLAP must be less than CHUNK_SIZE");
  }

  const out: TextChunk[] = [];
  let truncated = false;

  outer: for (const { page, text } of pages) {
    if (text.length === 0) continue;

    let start = 0;
    while (start < text.length) {
      if (out.length >= maxChunks) {
        truncated = true;
        break outer;
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

  return { chunks: out, truncated };
}
