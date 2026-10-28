-- Editors can't bypass review by writing to tables directly through the API.
begin;
set search_path = public, extensions;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'editor1@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'reviewer1@example.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'support1@example.test'),
  ('00000000-0000-0000-0000-0000000000e4', 'student1@example.test');
-- content_admin has content.review too, so use a custom editor-only role mix:
insert into public.user_roles(user_id, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'question_admin'),
  ('00000000-0000-0000-0000-0000000000e2', 'reviewer'),
  ('00000000-0000-0000-0000-0000000000e3', 'support');
-- Give the question admin note-writing rights without review rights.
insert into public.role_permissions(role, permission) values ('question_admin', 'content.manage') on conflict do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$
declare ok boolean; n uuid; v uuid; topic uuid := (select id from public.topics where title = 'Vital Signs');
begin
  -- Draft writes are fine
  insert into public.notes(topic_id, title) values (topic, 'Editor draft') returning id into n;
  insert into public.note_versions(note_id, version, body_md) values (n, 0, 'draft body') returning id into v;

  ok := false;
  begin update public.notes set status = 'published' where id = n;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'editor cannot publish a note directly';

  ok := false;
  begin update public.note_versions set status = 'approved' where id = v;
  exception when others then ok := true; end;
  assert ok, 'editor cannot approve their own version';
  assert (select status from public.note_versions where id = v) <> 'approved', 'version still unapproved';

  ok := false;
  begin update public.notes set current_version_id = v where id = n;
  exception when others then ok := true; end;
  assert ok, 'editor cannot point a note at an unapproved version';

  ok := false;
  begin update public.questions set status = 'published' where bank = 'practice';
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'questions cannot be edited outside the versioned RPC';
end $$;

-- Reviewer can publish through the workflow
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$
declare v uuid := (select v.id from public.note_versions v join public.notes n on n.id = v.note_id where n.title = 'Editor draft');
begin
  update public.note_versions set status = 'in_review' where id = v;  -- reviewers can read; submission normally by editor
exception when others then null;
end $$;
reset role;
update public.note_versions set status = 'in_review'
 where note_id = (select id from public.notes where title = 'Editor draft');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
do $$
declare n uuid := (select id from public.notes where title = 'Editor draft');
begin
  perform public.admin_review_note_version((select id from public.note_versions where note_id = n), true);
  assert (select status from public.notes where id = n) = 'published', 'reviewer publishes via workflow';
end $$;

-- Support: can grant access and notify, cannot touch AI config or prices
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', true);
do $$
begin
  perform public.admin_grant_entitlement('00000000-0000-0000-0000-0000000000e4', 'section_d', 7, 'Support goodwill');
  perform public.admin_notify_user('00000000-0000-0000-0000-0000000000e4', 'Hello', 'Test', '/support');
  update public.products set price_kobo = 1 where code = 'section_c';       -- filtered out by RLS
  update public.app_settings set value = '{}' where key = 'ai.config';      -- filtered out by RLS
end $$;
reset role;
do $$ begin
  assert (select price_kobo from public.products where code = 'section_c') = 150000, 'support cannot change prices';
  assert (select value ? 'fast_model' from public.app_settings where key = 'ai.config'), 'support cannot change AI config';
end $$;
set local role authenticated;

-- Student sees the notification and the access
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e4', true);
do $$ begin
  assert (select count(*) from public.notifications where title = 'Hello') = 1, 'student receives notification';
  assert public.has_entitlement('section_d'), 'complimentary access works';
  assert (public.exam_catalogue('D')->>'has_access')::boolean, 'catalogue shows access';
end $$;

reset role;
rollback;
