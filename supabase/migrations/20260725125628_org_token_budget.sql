-- Org-level token budget (shown in dashboard footer; shared across members).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS token_budget integer NOT NULL DEFAULT 1000;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_token_budget_positive;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_token_budget_positive
  CHECK (token_budget >= 1 AND token_budget <= 100000000);

COMMENT ON COLUMN public.organizations.token_budget IS
  'Org-wide max token budget for the dashboard usage meter.';

-- Members can update their org (used to persist token_budget from the API).
-- SELECT policy already exists; UPDATE also needs SELECT per Postgres RLS.
DROP POLICY IF EXISTS "Users can update their organizations" ON public.organizations;

CREATE POLICY "Users can update their organizations"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  )
  WITH CHECK (
    id IN (
      SELECT memberships.organization_id
      FROM public.memberships
      WHERE memberships.user_id = auth.uid()
    )
  );
