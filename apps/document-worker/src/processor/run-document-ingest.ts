/**
 * Ingest pipeline: CAS claim → download PDF → extract → chunk → embed → RPC finalize.
 * Duplicate queue messages are safe: claim returns null if another worker already took the row.
 */
import type OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkPages } from "../chunk/split.js";
import {
  claimDocumentForProcessing,
  failDocumentProcessing,
  finalizeDocumentIngest,
  type ChunkForRpc,
} from "../db/claim-and-finalize.js";
import type { WorkerConfig } from "../config.js";
import { extractPdfPages } from "../extract/pdf.js";
import type { ParsedIngestJob } from "../consumer.js";
import { embedTextsBatched } from "../embed/openai.js";
import { downloadDocumentPdf } from "../storage/download-pdf.js";

/** One JSON line per stage for log aggregation (correlationId links to upload/worker). */
function logStructured(
  job: ParsedIngestJob,
  stage: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      correlationId: job.correlationId,
      documentId: job.documentId,
      organizationId: job.organizationId,
      stage,
      durationMs,
      ...extra,
    }),
  );
}

export async function runDocumentIngest(
  supabase: SupabaseClient,
  openai: OpenAI,
  config: WorkerConfig,
  job: ParsedIngestJob,
): Promise<void> {
  const tClaim = Date.now();
  // Set after a successful claim so catch can call fail RPC (row must be processing).
  let claimedOrg: string | null = null;

  try {
    const row = await claimDocumentForProcessing(supabase, job.documentId);
    logStructured(job, "claim", Date.now() - tClaim, { claimed: Boolean(row) });

    if (!row) {
      return;
    }

    claimedOrg = row.organization_id;

    // Payload is untrusted; authoritative org is the documents row.
    if (row.organization_id !== job.organizationId) {
      await failDocumentProcessing(
        supabase,
        job.documentId,
        row.organization_id,
        "queue organizationId does not match document row",
      );
      return;
    }

    // Download PDF from Storage.
    const tDl = Date.now();
    const pdfBytes = await downloadDocumentPdf(
      supabase,
      row.storage_path,
      config.maxPdfBytes,
    );
    logStructured(job, "download", Date.now() - tDl, {
      bytes: pdfBytes.byteLength,
    });

    // Extract text per page.
    const tEx = Date.now();
    const pages = await extractPdfPages(pdfBytes);
    logStructured(job, "extract", Date.now() - tEx, { pages: pages.length });

    // Chunk text with overlap.
    const tCh = Date.now();
    const textChunks = chunkPages(
      pages,
      config.chunkSize,
      config.chunkOverlap,
      config.maxChunksPerDocument,
    );
    logStructured(job, "chunk", Date.now() - tCh, {
      chunks: textChunks.length,
    });

    if (textChunks.length === 0) {
      // Claimed processing; mark failed so the row is not stuck.
      await failDocumentProcessing(
        supabase,
        job.documentId,
        row.organization_id,
        "no text chunks produced",
      );
      return;
    }

    // Embed text chunks.
    const tEmb = Date.now();
    const embeddings = await embedTextsBatched(
      openai,
      textChunks.map((c) => c.text),
      {
        model: config.embeddingModel,
        dimensions: config.embeddingDimensions,
        batchSize: 64,
      },
    );
    logStructured(job, "embed", Date.now() - tEmb, {
      vectors: embeddings.length,
    });

    if (embeddings.length !== textChunks.length) {
      throw new Error("embedding count does not match chunk count");
    }

    // Validate embedding dimensions. Must match supabase migration vector(1536) and OpenAI output.
    const dbDim = 1536;
    if (config.embeddingDimensions !== dbDim) {
      console.log(
        JSON.stringify({
          correlationId: job.correlationId,
          documentId: job.documentId,
          stage: "warn",
          message: `EMBEDDING_DIMENSIONS=${config.embeddingDimensions} but DB migration uses vector(${dbDim}); set dimensions to ${dbDim}`,
        }),
      );
    }
    for (let i = 0; i < embeddings.length; i++) {
      const len = embeddings[i]!.length;
      if (len !== dbDim) {
        throw new Error(
          `embedding[${i}] length ${len} does not match vector(${dbDim})`,
        );
      }
    }

    const rpcChunks: ChunkForRpc[] = textChunks.map((c, i) => ({
      chunk_index: i,
      content: c.text,
      metadata: c.metadata,
      embedding: embeddings[i]!,
    }));

    // Finalize ingest.
    const tFn = Date.now();
    await finalizeDocumentIngest(
      supabase,
      job.documentId,
      row.organization_id,
      rpcChunks,
    );
    logStructured(job, "finalize", Date.now() - tFn, {});
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : typeof e === "string" ? e : "unknown";
    logStructured(job, "error", 0, { error: msg });

    // No claim → nothing to fail; duplicate-safe. With claim → surface error on the document row.
    if (claimedOrg) {
      await failDocumentProcessing(
        supabase,
        job.documentId,
        claimedOrg,
        msg,
      );
    }
  }
}
