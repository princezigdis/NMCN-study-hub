-- Access control, RLS and paid-section gating.
begin;
set search_path = public, extensions;

-- Test accounts (the auth trigger creates profiles + wallets).
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'student.a@example.test', '{"full_name":"Student A"}'),
  ('00000000-0000-0000-0000-00000000000b', 'student.b@example.test', '{"full_name":"Student B"}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.test', '{}'),
  ('00000000-0000-0000-0000-0000000000ed', 'editor@example.test', '{}');
insert into public.user_roles(user_id, role) values
  ('00000000-0000-0000-0000-0000000000ad', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000ed', 'content_admin');

do $$ begin
  assert (select count(*) from public.profiles where email like '%example.test') = 4, 'profiles auto-created';
  assert (select count(*) from public.credit_wallets w join public.profiles p on p.id = w.user_id where p.email like '%example.test') = 4, 'wallets auto-created';
end $$;

-- ================= Student A =================
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);

do $$
declare ok boolean;
begin
  assert (select count(*) from public.courses) >= 2, 'student sees published courses';
  assert (select count(*) from public.question_options) = 0, 'answer keys hidden from students';
  assert (select count(*) from public.questions where bank <> 'practice') = 0, 'exam banks hidden from students';
  assert (select count(*) from public.questions where bank = 'practice') >= 10, 'practice stems visible';
  assert (select count(*) from public.note_versions) = (select count(*) from public.notes where status = 'published'),
    'students see only current published versions';
  assert (select count(*) from public.profiles) = 1, 'student sees only own profile';
  assert (select count(*) from public.audit_logs) = 0, 'audit log hidden';
  assert (select count(*) from public.app_settings) = 0, 'settings hidden';

  -- Allowed self-service profile edit
  update public.profiles set full_name = 'Student A Renamed', programme_id = (select id from public.programmes where code = 'RN')
   where id = auth.uid();
  assert (select full_name from public.profiles where id = auth.uid()) = 'Student A Renamed', 'own profile editable';

  ok := false;
  begin update public.profiles set status = 'active' where id = auth.uid();
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot change account status column';

  ok := false;
  begin insert into public.entitlements(user_id, product_code, source, granted_by)
        values (auth.uid(), 'section_c', 'admin_grant', auth.uid());
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot self-grant entitlements';

  ok := false;
  begin insert into public.user_roles(user_id, role) values (auth.uid(), 'super_admin');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot self-assign roles';

  ok := false;
  begin update public.credit_wallets set balance = 999999 where user_id = auth.uid();
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot edit credit balance';

  ok := false;
  begin perform public.ai_reserve(auth.uid(), 'summarize', 'abcdefgh-1', '{}');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot call ai_reserve directly';

  ok := false;
  begin perform public.payment_fulfill('x', 1, 'NGN', null, null, null, '{}');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot call payment_fulfill';

  ok := false;
  begin perform public.admin_overview();
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot open admin overview';

  ok := false;
  begin perform public.admin_grant_entitlement(auth.uid(), 'section_c', 30, 'please');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'student cannot grant access';

  -- Own bookmarks only
  insert into public.bookmarks(note_id) select id from public.notes limit 1;
  ok := false;
  begin insert into public.bookmarks(user_id, note_id)
        select '00000000-0000-0000-0000-00000000000b', id from public.notes limit 1;
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'cannot write bookmarks for another user';

  -- Paid sections are locked
  ok := false;
  begin perform public.exam_start((select p.id from public.exam_papers p join public.exam_configs c on c.id = p.config_id
                                     where c.section = 'C' and p.paper_number = 1));
  exception when others then ok := sqlerrm like 'payment_required%'; end;
  assert ok, 'Section C requires payment';

  assert (public.exam_catalogue('C')->>'has_access')::boolean = false, 'catalogue reports no access';
end $$;

-- ================= Content admin: role is limited =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ed', true);
do $$
declare ok boolean;
begin
  assert (select count(*) from public.courses where status <> 'published') >= 0, 'editor can query content';
  ok := false;
  begin perform public.admin_grant_entitlement('00000000-0000-0000-0000-00000000000a', 'section_c', 30, 'test');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'content admin cannot grant paid access';
  ok := false;
  begin perform public.admin_set_role('00000000-0000-0000-0000-0000000000ed', 'super_admin', true);
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'content admin cannot escalate own role';
end $$;

-- ================= Super admin grants Section C =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', true);
do $$
declare before_n int := (select count(*) from public.audit_logs);
begin
  perform public.admin_grant_entitlement('00000000-0000-0000-0000-00000000000a', 'section_c', 30, 'Scholarship');
  assert (select count(*) from public.audit_logs) > before_n, 'grant is audited';
  assert (public.admin_overview()->>'users_total')::int >= 4, 'admin overview works';
end $$;

-- ================= Student A sits Section C, still locked out of D ==========
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare v_att uuid; v_exam jsonb; item jsonb; ok boolean; v_res jsonb; v_again uuid;
begin
  v_att := (public.exam_start((select p.id from public.exam_papers p join public.exam_configs c on c.id = p.config_id
                                where c.section = 'C' and p.paper_number = 1))->>'attempt_id')::uuid;
  -- Resume returns the same attempt instead of creating a new one
  v_again := (public.exam_start((select paper_id from public.exam_attempts where id = v_att))->>'attempt_id')::uuid;
  assert v_again = v_att, 'open attempt is resumed';

  v_exam := public.exam_get(v_att);
  assert jsonb_array_length(v_exam->'items') = 4, 'paper has 4 items';
  assert not (v_exam->'items'->0 ? 'feedback'), 'no answers/rationales during the exam';
  assert (v_exam->>'review_available')::boolean = false, 'no review before submit';

  for item in select * from jsonb_array_elements(v_exam->'items') loop
    perform public.exam_save_answer(v_att, (item->>'position')::int, (item->'options'->0->>'id')::uuid, false);
  end loop;

  ok := false;
  begin perform public.exam_save_answer(v_att, 1, gen_random_uuid(), false);
  exception when others then ok := sqlerrm = 'invalid_option'; end;
  assert ok, 'foreign option ids rejected';

  v_res := public.exam_submit(v_att);
  assert (v_res->>'total')::int = 4, 'scored server-side';
  assert (v_res->>'percent') is not null, 'percent computed';
  assert (public.exam_get(v_att)->>'review_available')::boolean, 'review after submit';

  ok := false;
  begin perform public.exam_save_answer(v_att, 1, null, false);
  exception when others then ok := sqlerrm = 'attempt_closed'; end;
  assert ok, 'cannot change answers after submit';

  ok := false;
  begin perform public.exam_start((select p.id from public.exam_papers p join public.exam_configs c on c.id = p.config_id
                                     where c.section = 'D' limit 1));
  exception when others then ok := sqlerrm like 'payment_required%'; end;
  assert ok, 'Section C purchase does not unlock Section D';
end $$;

-- ================= Suspension =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ad', true);
select public.admin_set_user_status('00000000-0000-0000-0000-00000000000b', 'suspended', 'Abuse report');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
do $$
declare ok boolean := false;
begin
  begin perform public.practice_start(10);
  exception when others then ok := sqlerrm = 'account_suspended'; end;
  assert ok, 'suspended accounts are blocked';
end $$;

reset role;
rollback;
