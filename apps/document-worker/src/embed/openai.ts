import OpenAI from "openai";

const MAX_INPUT_CHARS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  return text.slice(0, MAX_INPUT_CHARS);
}

/**
 * Embeds texts in batches with basic 429 / 5xx backoff.
 */
export async function embedTextsBatched(
  client: OpenAI,
  texts: string[],
  options: {
    model: string;
    dimensions: number;
    batchSize: number;
  },
): Promise<number[][]> {
  const { model, dimensions, batchSize } = options;
  const inputs = texts.map(truncateForEmbedding);
  const out: number[][] = [];

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    let attempt = 0;
    let lastErr: Error | undefined;
    let done = false;

    while (attempt < 6 && !done) {
      try {
        const res = await client.embeddings.create({
          model,
          input: batch,
          dimensions,
        });

        const vectors = res.data
          .sort((a, b) => a.index - b.index)
          .map((d) => d.embedding as number[]);

        if (vectors.length !== batch.length) {
          throw new Error("OpenAI embeddings: length mismatch");
        }

        out.push(...vectors);
        done = true;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const status =
          e && typeof e === "object" && "status" in e
            ? (e as { status?: number }).status
            : undefined;
        const retryable =
          status === 429 || status === 503 || status === 502 || status === 500;
        if (!retryable && status !== undefined) {
          throw lastErr;
        }
        const delay = Math.min(
          30_000,
          500 * 2 ** attempt + Math.random() * 250,
        );
        await sleep(delay);
        attempt += 1;
      }
    }

    if (!done) {
      throw lastErr ?? new Error("OpenAI embeddings failed");
    }
  }

  return out;
}
