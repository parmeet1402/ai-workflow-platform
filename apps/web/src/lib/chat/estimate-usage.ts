import type { ChatUsage } from "@/lib/chat/types";

/** Rough chars-per-token used when the provider omits stream usage. */
const CHARS_PER_TOKEN = 4;

function estimateTokenCount(text: string): number {
  const len = text.length;
  if (len <= 0) return 0;
  return Math.max(1, Math.ceil(len / CHARS_PER_TOKEN));
}

/**
 * Fallback token accounting when OpenAI does not return `usage` on the
 * final streamed chunk (despite `stream_options.include_usage`).
 */
export function estimateChatUsage(options: {
  promptTexts: string[];
  completionText: string;
}): ChatUsage {
  const promptTokens = options.promptTexts.reduce(
    (sum, text) => sum + estimateTokenCount(text),
    0,
  );
  const completionTokens = estimateTokenCount(options.completionText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export function hasProviderUsage(usage: ChatUsage): boolean {
  return usage.totalTokens > 0 || usage.promptTokens > 0 || usage.completionTokens > 0;
}
