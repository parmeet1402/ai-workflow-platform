import { extractText, getDocumentProxy } from "unpdf";

export type PageText = { page: number; text: string };

/**
 * Extract plain text per page (1-based page numbers in metadata downstream).
 */
export async function extractPdfPages(pdfBytes: Uint8Array): Promise<PageText[]> {
  const pdf = await getDocumentProxy(pdfBytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  if (!Array.isArray(text)) {
    throw new Error("extractText did not return per-page strings");
  }

  const out: PageText[] = [];
  for (let i = 0; i < text.length; i++) {
    const t = (text[i] ?? "").replace(/\s+/g, " ").trim();
    if (t.length > 0) {
      out.push({ page: i + 1, text: t });
    }
  }

  if (out.length === 0 && totalPages > 0) {
    throw new Error("No extractable text in PDF");
  }
  if (totalPages === 0) {
    throw new Error("PDF has no pages");
  }

  return out;
}
