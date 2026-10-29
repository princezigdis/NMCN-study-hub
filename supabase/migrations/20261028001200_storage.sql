-- =====================================================================
-- 1200 STORAGE BUCKETS & POLICIES
--   content          : note images & handout attachments (private; signed URLs)
--   question-images  : images for questions (private; signed URLs)
--   ai-images        : AI-generated diagrams, one folder per user (private)
-- All buckets are private. Files are served with short-lived signed URLs.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('content', 'content', false, 26214400,
   array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.presentationml.presentation']),
  ('question-images', 'question-images', false, 5242880, array['image/png','image/jpeg','image/webp']),
  ('ai-images', 'ai-images', false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'content read by signed-in users') then
    create policy "content read by signed-in users" on storage.objects for select to authenticated
      using (bucket_id in ('content','question-images') and public.is_active_user());
  end if;
end $do$;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'content managed by editors') then
    create policy "content managed by editors" on storage.objects for all to authenticated
      using (
        (bucket_id = 'content' and public.has_permission('content.manage')) or
        (bucket_id = 'question-images' and public.has_permission('questions.manage')))
      with check (
        (bucket_id = 'content' and public.has_permission('content.manage')) or
        (bucket_id = 'question-images' and public.has_permission('questions.manage')));
  end if;
end $do$;

-- AI images are written by the Edge Function (service role) into <user_id>/...
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ai images readable by owner') then
    create policy "ai images readable by owner" on storage.objects for select to authenticated
      using (bucket_id = 'ai-images' and (storage.foldername(name))[1] = auth.uid()::text);
  end if;
end $do$;
