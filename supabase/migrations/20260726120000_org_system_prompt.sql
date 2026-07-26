-- Org-wide chat system prompt (owner-managed; null = built-in RAG instructions).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS system_prompt text;

COMMENT ON COLUMN public.organizations.system_prompt IS
  'Org-wide chat system prompt. NULL means use the app built-in RAG instructions.';
