-- Harden Storage RLS on the `documents` bucket ahead of direct-to-storage (resumable) uploads.
--
-- The baseline migration shipped an overly broad policy: `to public`, no path scoping, so any
-- caller (including anon) could INSERT anywhere in the bucket. That was masked while the server
-- route built the storage path from the session's organization, but becomes a cross-org write
-- hole once the browser is allowed to upload bytes directly to Storage.
--
-- Replace it with a path-scoped policy: the first path segment (organization id) must be one of
-- the organizations the caller belongs to, per `public.memberships`. Add an UPDATE policy with
-- the same scope since resumable (TUS) uploads PATCH the in-progress object.
drop policy if exists "Users can upload documents flreew_0" on storage.objects;

create policy "documents_insert_own_org"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select m.organization_id::text
    from public.memberships m
    where m.user_id = auth.uid()
  )
);

create policy "documents_update_own_org"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] in (
    select m.organization_id::text
    from public.memberships m
    where m.user_id = auth.uid()
  )
);
