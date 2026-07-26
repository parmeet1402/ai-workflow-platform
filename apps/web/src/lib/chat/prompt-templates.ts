import type { PromptTemplate } from "@/lib/chat/chat-controls-storage";

export const PROMPT_TEMPLATE_NAME_MAX = 120;
export const PROMPT_TEMPLATE_BODY_MAX = 8_000;

export type PromptTemplateRow = {
  id: string;
  name: string;
  body: string;
  updated_at: string;
};

export function toPromptTemplate(row: PromptTemplateRow): PromptTemplate {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    updatedAt: row.updated_at,
  };
}

/**
 * Parse create/update payload fields.
 * - create: both name and body required (name may be empty → caller default)
 * - update: only provided fields; at least one of name/body must be present
 */
export function parseTemplateWriteBody(
  raw: unknown,
  mode: "create" | "update",
):
  | { name?: string; body?: string }
  | { error: string } {
  if (raw == null || typeof raw !== "object") {
    return { error: "Invalid JSON body" };
  }
  const body = raw as Record<string, unknown>;

  const hasName = "name" in body;
  const hasBody = "body" in body;

  if (mode === "create" && !hasBody) {
    return { error: "body is required" };
  }
  if (mode === "update" && !hasName && !hasBody) {
    return { error: "name or body is required" };
  }

  const out: { name?: string; body?: string } = {};

  if (hasName) {
    if (typeof body.name !== "string") {
      return { error: "name must be a string" };
    }
    const name = body.name.trim();
    if (name.length > PROMPT_TEMPLATE_NAME_MAX) {
      return {
        error: `name must be at most ${PROMPT_TEMPLATE_NAME_MAX} characters`,
      };
    }
    out.name = name;
  }

  if (hasBody) {
    if (typeof body.body !== "string") {
      return { error: "body must be a string" };
    }
    const text = body.body.trim();
    if (!text) {
      return { error: "body cannot be empty" };
    }
    if (text.length > PROMPT_TEMPLATE_BODY_MAX) {
      return {
        error: `body must be at most ${PROMPT_TEMPLATE_BODY_MAX} characters`,
      };
    }
    out.body = text;
  }

  return out;
}
