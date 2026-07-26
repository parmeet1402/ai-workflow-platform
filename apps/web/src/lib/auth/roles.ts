/** Org membership roles stored on `memberships.role`. */
export type OrgRole = string | null | undefined;

/** Owners may customize the chat system prompt; other members may not. */
export function canAdjustSystemPrompt(role: OrgRole): boolean {
  return role === "owner";
}
