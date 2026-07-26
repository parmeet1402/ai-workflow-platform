-- Defense in depth: only org owners may change organizations.system_prompt.
-- Members can still UPDATE other columns (e.g. token_budget) under existing RLS.

CREATE OR REPLACE FUNCTION public.enforce_owner_system_prompt_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE memberships.organization_id = OLD.id
      AND memberships.user_id = auth.uid()
      AND memberships.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only organization owners can update system_prompt'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_owner_system_prompt_update
  ON public.organizations;

CREATE TRIGGER trg_enforce_owner_system_prompt_update
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_owner_system_prompt_update();

COMMENT ON FUNCTION public.enforce_owner_system_prompt_update() IS
  'Blocks non-owner UPDATEs that change organizations.system_prompt.';
