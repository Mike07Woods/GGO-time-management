-- ============================================================================
-- GGO Time Management — Avatar uploads (Supabase Storage)
-- Run once in the Supabase SQL Editor. Enables the "Upload photo" button on the
-- Settings page. Files are stored at avatars/<user_id>/avatar.<ext>.
-- ============================================================================

-- Public bucket named "avatars" (public read so <img src> works directly).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can READ avatars (they're public profile pictures).
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

-- A user may upload / replace / delete ONLY files inside their own folder
-- (the first path segment must equal their user id).
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================================
-- DONE. Users can now upload a profile photo from Settings.
-- ============================================================================
