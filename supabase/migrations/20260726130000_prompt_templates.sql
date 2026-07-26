-- Org-scoped prompt templates (shared by all members).
-- Application routes still enforce membership; RLS is defense-in-depth.

CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL,
  name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prompt_templates_pkey PRIMARY KEY (id),
  CONSTRAINT prompt_templates_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT prompt_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prompt_templates_org_updated
  ON public.prompt_templates (organization_id, updated_at DESC);

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can view org prompt templates"
  ON public.prompt_templates
  FOR SELECT
  USING (
    organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can insert prompt templates in their org"
  ON public.prompt_templates
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can update org prompt templates"
  ON public.prompt_templates
  FOR UPDATE
  TO authenticated
  USING (
    organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "users can delete org prompt templates"
  ON public.prompt_templates
  FOR DELETE
  TO authenticated
  USING (
    organization_id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );

GRANT ALL ON TABLE public.prompt_templates TO anon;
GRANT ALL ON TABLE public.prompt_templates TO authenticated;
GRANT ALL ON TABLE public.prompt_templates TO service_role;
