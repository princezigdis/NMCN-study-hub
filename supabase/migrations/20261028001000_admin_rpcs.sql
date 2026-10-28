-- =====================================================================
-- 1000 ADMIN SERVER LOGIC
-- Every function checks permissions itself (require_permission), so the
-- admin UI being hidden is never the only protection.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Overview ---------------------------------------------------
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'permission_denied:staff' using errcode = '42501'; end if;
  return jsonb_build_object(
    'users_total', (select count(*) from public.profiles),
    'users_active_7d', (select count(*) from public.profiles where last_active_at > now() - interval '7 days'),
    'users_suspended', (select count(*) from public.profiles where status = 'suspended'),
    'by_programme', coalesce((select jsonb_object_agg(coalesce(pr.code, 'unset'), n)
                       from (select programme_id, count(*) n from public.profiles group by programme_id) x
                       left join public.programmes pr on pr.id = x.programme_id), '{}'),
    'courses', (select count(*) from public.courses where status = 'published'),
    'notes_published', (select count(*) from public.notes where status = 'published'),
    'notes_in_review', (select count(*) from public.note_versions where status = 'in_review'),
    'questions', coalesce((select jsonb_object_agg(bank || ':' || status, n)
                    from (select bank, status, count(*) n from public.questions group by bank, status) x), '{}'),
    'exam_attempts_30d', (select count(*) from public.exam_attempts where started_at > now() - interval '30 days'),
    'exam_avg_percent_30d', (select round(avg(percent), 1) from public.exam_attempts
                               where status <> 'in_progress' and started_at > now() - interval '30 days'),
    'ai_requests_30d', (select count(*) from public.ai_requests where created_at > now() - interval '30 days'),
    'ai_failures_30d', (select count(*) from public.ai_requests where status = 'refunded' and created_at > now() - interval '30 days'),
    'ai_cost_usd_30d', (select coalesce(round(sum(est_cost_usd), 2), 0) from public.ai_requests where created_at > now() - interval '30 days'),
    'ai_cost_usd_today', (select coalesce(round(sum(est_cost_usd), 4), 0) from public.ai_requests where created_at >= date_trunc('day', now())),
    'subscriptions', coalesce((select jsonb_object_agg(plan_code, n) from (
                        select plan_code, count(*) n from public.ai_subscriptions
                         where status = 'active' and ends_at > now() group by plan_code) x), '{}'),
    'entitlements', coalesce((select jsonb_object_agg(product_code, n) from (
                        select product_code, count(*) n from public.entitlements
                         where status = 'active' and (expires_at is null or expires_at > now()) group by product_code) x), '{}'),
    'revenue_kobo_30d', (select coalesce(sum(amount_kobo), 0) from public.payments where status = 'success' and paid_at > now() - interval '30 days'),
    'payments_failed_30d', (select count(*) from public.payments where status in ('failed','amount_mismatch') and created_at > now() - interval '30 days'),
    'open_reports', (select count(*) from public.content_reports where status in ('open','reviewing')),
    'open_tickets', (select count(*) from public.support_tickets where status <> 'closed')
  );
end $$;

-- ---------- Ordering -------------------------------------------------
create or replace function public.admin_reorder(p_table text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table in ('courses','modules','topics','notes','note_references') then
    perform public.require_permission('content.manage');
  elsif p_table in ('exam_configs','station_checklist_items','station_viva_questions','exam_paper_stations') then
    perform public.require_permission('exams.manage');
  else
    raise exception 'reorder_not_allowed:%', p_table;
  end if;
  if p_table = 'exam_paper_stations' then
    update public.exam_paper_stations s set position = u.ord from unnest(p_ids) with ordinality u(id, ord) where s.station_id = u.id;
  else
    execute format('update public.%I t set position = u.ord from unnest($1) with ordinality u(id, ord) where t.id = u.id', p_table)
      using p_ids;
  end if;
end $$;

-- ---------- Notes workflow --------------------------------------------
create or replace function public.admin_submit_note_version(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('content.manage');
  update public.note_versions set status = 'in_review' where id = p_version and status in ('draft','rejected');
  if not found then raise exception 'version_not_submittable'; end if;
end $$;

create or replace function public.admin_review_note_version(p_version uuid, p_approve boolean, p_note text default null, p_review_due date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.note_versions;
begin
  perform public.require_permission('content.review');
  select * into v from public.note_versions where id = p_version for update;
  if not found then raise exception 'version_not_found'; end if;
  if not p_approve then
    update public.note_versions set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           change_summary = coalesce(change_summary, '') || case when p_note is null then '' else E'\nReviewer: ' || p_note end
     where id = p_version;
    perform public.audit('REJECT', 'note_versions', p_version::text, null, null, p_note);
    return;
  end if;
  update public.note_versions set status = 'superseded' where note_id = v.note_id and status = 'approved' and id <> v.id;
  update public.note_versions set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_due_at = coalesce(p_review_due, review_due_at) where id = v.id;
  update public.notes set current_version_id = v.id, status = 'published' where id = v.note_id;
  perform public.audit('PUBLISH', 'note_versions', p_version::text, null, jsonb_build_object('note_id', v.note_id, 'version', v.version), p_note);
end $$;

create or replace function public.admin_restore_note_version(p_version uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.note_versions; v_new uuid;
begin
  perform public.require_permission('content.manage');
  select * into v from public.note_versions where id = p_version;
  if not found then raise exception 'version_not_found'; end if;
  insert into public.note_versions(note_id, version, body_md, source_reference, change_summary, status)
  values (v.note_id, 0, v.body_md, v.source_reference, format('Restored from version %s', v.version), 'draft')
  returning id into v_new;
  return v_new;
end $$;

create or replace function public.admin_set_content_status(p_table text, p_id uuid, p_status public.publication_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table not in ('courses','modules','topics','notes','curriculum_versions') then
    raise exception 'invalid_table';
  end if;
  if p_status = 'published' then perform public.require_permission('content.review');
  else perform public.require_permission('content.manage'); end if;
  if p_table = 'notes' and p_status = 'published'
     and (select current_version_id from public.notes where id = p_id) is null then
    raise exception 'note_needs_approved_version';
  end if;
  execute format('update public.%I set status = $1 where id = $2', p_table) using p_status, p_id;
  perform public.audit('STATUS', p_table, p_id::text, null, jsonb_build_object('status', p_status));
end $$;

-- ---------- Questions ------------------------------------------------
-- Payload: { id?, bank, course_id, topic_id, stem, clinical_scenario, image_path, difficulty,
--            source_reference, tags[], programmes["RN","RM"], options[{label,body,is_correct,rationale}],
--            change_note, status? }
create or replace function public.admin_save_question(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.questions;
  v_status public.publication_status;
  v_labels text[];
  o jsonb;
  probs text[];
begin
  perform public.require_permission('questions.manage');
  if jsonb_typeof(p->'options') <> 'array' or jsonb_array_length(p->'options') < 2 then
    raise exception 'question_invalid: needs at least two options';
  end if;

  if v_id is not null then
    select * into v_old from public.questions where id = v_id for update;
    if not found then raise exception 'question_not_found'; end if;
  end if;

  v_status := coalesce(nullif(p->>'status', '')::public.publication_status, v_old.status, 'draft');
  if v_status = 'published' and (v_old.status is distinct from 'published') then
    perform public.require_permission('questions.review');
  end if;

  if v_id is null then
    insert into public.questions(bank, course_id, topic_id, stem, clinical_scenario, image_path, difficulty,
                                 source_reference, tags, status, created_by, is_demo)
    values (coalesce((p->>'bank')::public.question_bank, 'practice'), nullif(p->>'course_id', '')::uuid,
            nullif(p->>'topic_id', '')::uuid, trim(p->>'stem'), nullif(trim(p->>'clinical_scenario'), ''),
            nullif(p->>'image_path', ''), coalesce((p->>'difficulty')::public.difficulty_level, 'medium'),
            nullif(trim(p->>'source_reference'), ''),
            coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'tags', '[]')) x where trim(x) <> ''), '{}'),
            'draft', auth.uid(), coalesce((p->>'is_demo')::boolean, false))
    returning id into v_id;
  else
    update public.questions set
      bank = coalesce((p->>'bank')::public.question_bank, bank),
      course_id = nullif(p->>'course_id', '')::uuid, topic_id = nullif(p->>'topic_id', '')::uuid,
      stem = trim(p->>'stem'), clinical_scenario = nullif(trim(p->>'clinical_scenario'), ''),
      image_path = nullif(p->>'image_path', ''),
      difficulty = coalesce((p->>'difficulty')::public.difficulty_level, difficulty),
      source_reference = nullif(trim(p->>'source_reference'), ''),
      tags = coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'tags', '[]')) x where trim(x) <> ''), '{}'),
      is_demo = coalesce((p->>'is_demo')::boolean, is_demo),
      version = version + 1
    where id = v_id;
    if v_old.bank is distinct from coalesce((p->>'bank')::public.question_bank, v_old.bank) then
      delete from public.question_pool_items where question_id = v_id;  -- pools are bank-specific
    end if;
  end if;

  -- Options: upsert by label so existing option ids (and answer history) survive edits.
  select array_agg(upper(x->>'label')) into v_labels from jsonb_array_elements(p->'options') x;
  delete from public.question_options where question_id = v_id and not (label = any(v_labels));
  for o in select * from jsonb_array_elements(p->'options') loop
    insert into public.question_options(question_id, label, body, is_correct, rationale, position)
    values (v_id, upper(o->>'label'), trim(o->>'body'), coalesce((o->>'is_correct')::boolean, false),
            nullif(trim(o->>'rationale'), ''), ascii(upper(o->>'label')) - 64)
    on conflict (question_id, label) do update set body = excluded.body, is_correct = excluded.is_correct,
       rationale = excluded.rationale, position = excluded.position;
  end loop;

  if p ? 'programmes' then
    delete from public.question_programmes where question_id = v_id;
    insert into public.question_programmes(question_id, programme_id)
    select v_id, pr.id from public.programmes pr
     where pr.code in (select upper(trim(x)) from jsonb_array_elements_text(p->'programmes') x);
  end if;

  if v_status = 'published' then
    probs := public.question_problems(v_id);
    if array_length(probs, 1) > 0 then raise exception 'question_invalid: %', array_to_string(probs, '; '); end if;
  end if;
  update public.questions set status = v_status,
         reviewed_by = case when v_status = 'published' and v_old.status is distinct from 'published' then auth.uid() else reviewed_by end,
         reviewed_at = case when v_status = 'published' and v_old.status is distinct from 'published' then now() else reviewed_at end
   where id = v_id;

  insert into public.question_versions(question_id, version, snapshot, change_note, changed_by)
  select q.id, q.version,
         to_jsonb(q) - 'stem_normalized' || jsonb_build_object(
           'options', (select jsonb_agg(to_jsonb(op) order by op.label) from public.question_options op where op.question_id = q.id),
           'programmes', (select jsonb_agg(pr.code) from public.question_programmes qp join public.programmes pr on pr.id = qp.programme_id where qp.question_id = q.id)),
         nullif(p->>'change_note', ''), auth.uid()
    from public.questions q where q.id = v_id
  on conflict (question_id, version) do nothing;

  return v_id;
end $$;

create or replace function public.admin_set_question_status(p_ids uuid[], p_status public.publication_status)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; probs text[]; v_ok int := 0; v_failed jsonb := '[]';
begin
  if p_status = 'published' then perform public.require_permission('questions.review');
  else perform public.require_permission('questions.manage'); end if;
  foreach v_id in array p_ids loop
    if p_status = 'published' then
      probs := public.question_problems(v_id);
      if array_length(probs, 1) > 0 then
        v_failed := v_failed || jsonb_build_object('id', v_id, 'problems', to_jsonb(probs));
        continue;
      end if;
    end if;
    update public.questions set status = p_status,
           reviewed_by = case when p_status = 'published' then auth.uid() else reviewed_by end,
           reviewed_at = case when p_status = 'published' then now() else reviewed_at end
     where id = v_id;
    if found then v_ok := v_ok + 1; end if;
  end loop;
  perform public.audit('STATUS', 'questions', null, null, jsonb_build_object('status', p_status, 'count', v_ok));
  return jsonb_build_object('updated', v_ok, 'failed', v_failed);
end $$;

create or replace function public.admin_similar_questions(p_stem text, p_bank public.question_bank default null, p_exclude uuid default null)
returns table(id uuid, stem text, bank public.question_bank, status public.publication_status, similarity real)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform public.require_permission('questions.manage');
  return query
  select q.id, q.stem, q.bank, q.status, similarity(q.stem_normalized, lower(regexp_replace(p_stem, '\s+', ' ', 'g')))
    from public.questions q
   where (p_bank is null or q.bank = p_bank) and (p_exclude is null or q.id <> p_exclude)
     and q.stem_normalized % lower(regexp_replace(p_stem, '\s+', ' ', 'g'))
   order by 5 desc limit 5;
end $$;

-- Bulk import. Rows: [{ bank, course_code, topic_title | topic_id, stem, scenario, difficulty,
--   programmes:"RN,RM", option_a..option_e, rationale_a..rationale_e, correct:"B", source, tags }]
-- Returns a per-row report; each row is isolated (one bad row never blocks others).
create or replace function public.admin_import_questions(p_rows jsonb, p_status public.publication_status default 'draft',
                                                         p_skip_duplicates boolean default true, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r jsonb; i int := 0; v_topic uuid; v_course uuid; v_opts jsonb; v_lbl text; v_id uuid;
  v_dup record; v_bank public.question_bank; v_correct text;
  ok jsonb := '[]'; dups jsonb := '[]'; errs jsonb := '[]';
begin
  perform public.require_permission('questions.manage');
  if p_status not in ('draft','in_review','published') then raise exception 'invalid_import_status'; end if;
  if p_status = 'published' then perform public.require_permission('questions.review'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'import_must_be_array_of_max_2000_rows';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_bank := coalesce(nullif(lower(r->>'bank'), ''), 'practice')::public.question_bank;
      v_topic := nullif(r->>'topic_id', '')::uuid;
      v_course := null;
      if nullif(r->>'course_code', '') is not null then
        select id into v_course from public.courses where lower(code) = lower(trim(r->>'course_code'));
        if v_course is null then raise exception 'unknown course_code "%"', r->>'course_code'; end if;
      end if;
      if v_topic is null and nullif(r->>'topic_title', '') is not null then
        select t.id into v_topic from public.topics t join public.modules m on m.id = t.module_id
         where lower(t.title) = lower(trim(r->>'topic_title')) and (v_course is null or m.course_id = v_course)
         limit 1;
        if v_topic is null then raise exception 'unknown topic_title "%"', r->>'topic_title'; end if;
      end if;
      if coalesce(trim(r->>'stem'), '') = '' then raise exception 'stem is required'; end if;
      v_correct := upper(trim(coalesce(r->>'correct', '')));
      if v_correct !~ '^[A-E]$' then raise exception 'correct must be one letter A-E'; end if;

      v_opts := '[]';
      foreach v_lbl in array array['a','b','c','d','e'] loop
        if coalesce(trim(r->>('option_' || v_lbl)), '') <> '' then
          v_opts := v_opts || jsonb_build_object('label', upper(v_lbl), 'body', r->>('option_' || v_lbl),
                     'rationale', r->>('rationale_' || v_lbl), 'is_correct', upper(v_lbl) = v_correct);
        end if;
      end loop;
      if jsonb_array_length(v_opts) < 2 then raise exception 'at least two options are required'; end if;
      if not exists (select 1 from jsonb_array_elements(v_opts) x where (x->>'is_correct')::boolean) then
        raise exception 'correct answer % has no option text', v_correct;
      end if;

      select q.id, similarity(q.stem_normalized, lower(regexp_replace(r->>'stem', '\s+', ' ', 'g'))) sim
        into v_dup from public.questions q
       where q.bank = v_bank and q.stem_normalized % lower(regexp_replace(r->>'stem', '\s+', ' ', 'g'))
       order by 2 desc limit 1;
      if v_dup.id is not null and v_dup.sim >= 0.85 then
        dups := dups || jsonb_build_object('row', i, 'existing_id', v_dup.id, 'similarity', round(v_dup.sim::numeric, 2));
        if p_skip_duplicates then continue; end if;
      end if;

      if not p_dry_run then
        v_id := public.admin_save_question(jsonb_build_object(
          'bank', v_bank, 'course_id', coalesce(v_course, (select m.course_id from public.topics t join public.modules m on m.id = t.module_id where t.id = v_topic)),
          'topic_id', v_topic, 'stem', r->>'stem', 'clinical_scenario', r->>'scenario',
          'difficulty', coalesce(nullif(lower(r->>'difficulty'), ''), 'medium'),
          'source_reference', r->>'source',
          'tags', to_jsonb(string_to_array(coalesce(r->>'tags', ''), ',')),
          'programmes', to_jsonb(string_to_array(coalesce(nullif(r->>'programmes', ''), 'RN,RM'), ',')),
          'options', v_opts, 'status', p_status, 'change_note', 'Bulk import'));
        ok := ok || jsonb_build_object('row', i, 'id', v_id);
      else
        ok := ok || jsonb_build_object('row', i);
      end if;
    exception when others then
      errs := errs || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;

  if not p_dry_run then
    perform public.audit('IMPORT', 'questions', null, null,
      jsonb_build_object('inserted', jsonb_array_length(ok), 'duplicates', jsonb_array_length(dups), 'errors', jsonb_array_length(errs)));
  end if;
  return jsonb_build_object('dry_run', p_dry_run, 'inserted', ok, 'duplicates', dups, 'errors', errs);
end $$;

-- ---------- Users & access --------------------------------------------
create or replace function public.admin_user_detail(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_permission('users.view');
  return jsonb_build_object(
    'profile', (select to_jsonb(p) || jsonb_build_object('programme', pr.code)
                  from public.profiles p left join public.programmes pr on pr.id = p.programme_id where p.id = p_user),
    'roles', coalesce((select jsonb_agg(role) from public.user_roles where user_id = p_user), '[]'),
    'entitlements', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from public.entitlements e where e.user_id = p_user), '[]'),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.ai_subscriptions s where s.user_id = p_user), '[]'),
    'wallet', (select to_jsonb(w) from public.credit_wallets w where w.user_id = p_user),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'reference', reference, 'item_code', item_code,
                   'amount_kobo', amount_kobo, 'status', status, 'mode', mode, 'created_at', created_at, 'paid_at', paid_at)
                   order by created_at desc) from public.payments where user_id = p_user), '[]'),
    'ai_usage_30d', (select jsonb_build_object('requests', count(*), 'credits', coalesce(sum(credits_charged), 0))
                       from public.ai_requests where user_id = p_user and created_at > now() - interval '30 days'),
    'exam_attempts', (select count(*) from public.exam_attempts where user_id = p_user),
    'practice_answered', (select count(*) from public.practice_items pi join public.practice_sessions ps on ps.id = pi.session_id
                           where ps.user_id = p_user and pi.answered_at is not null),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'subject', subject, 'status', status, 'created_at', created_at)
                   order by created_at desc) from public.support_tickets where user_id = p_user), '[]')
  );
end $$;

create or replace function public.admin_set_user_status(p_user uuid, p_status public.account_status, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('users.manage');
  if p_user = auth.uid() then raise exception 'cannot_change_own_status'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'super_admin')
     and not public.has_permission('roles.manage') then
    raise exception 'cannot_suspend_super_admin';
  end if;
  update public.profiles set status = p_status,
         suspended_reason = case when p_status = 'suspended' then p_reason end
   where id = p_user;
end $$;

create or replace function public.admin_set_programme(p_user uuid, p_programme text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('users.manage');
  update public.profiles set programme_id = (select id from public.programmes where code = upper(p_programme)) where id = p_user;
  perform public.audit('PROGRAMME', 'profiles', p_user::text, null, jsonb_build_object('programme', p_programme));
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role public.app_role, p_grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('roles.manage');
  if p_grant then
    insert into public.user_roles(user_id, role, granted_by) values (p_user, p_role, auth.uid()) on conflict do nothing;
  else
    if p_role = 'super_admin' and (select count(*) from public.user_roles where role = 'super_admin') <= 1 then
      raise exception 'cannot_remove_last_super_admin';
    end if;
    delete from public.user_roles where user_id = p_user and role = p_role;
  end if;
end $$;

create or replace function public.admin_grant_entitlement(p_user uuid, p_product text, p_days int, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_permission('access.grant');
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if p_days is not null and (p_days < 1 or p_days > 730) then raise exception 'invalid_days'; end if;
  insert into public.entitlements(user_id, product_code, source, granted_by, reason, starts_at, expires_at)
  values (p_user, p_product, 'admin_grant', auth.uid(), p_reason, now(),
          case when p_days is null then null else now() + make_interval(days => p_days) end)
  returning id into v_id;
  insert into public.notifications(user_id, title, body, link)
  select p_user, name || ' access granted', 'An administrator granted you access.',
         case p_product when 'section_c' then '/mock' else '/final' end
    from public.products where code = p_product;
  return v_id;
end $$;

create or replace function public.admin_revoke_entitlement(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('access.grant');
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  update public.entitlements set status = 'revoked', reason = coalesce(reason, '') || ' | revoked: ' || p_reason
   where id = p_id and status = 'active';
end $$;

create or replace function public.admin_extend_entitlement(p_id uuid, p_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('access.grant');
  if p_days < 1 or p_days > 730 then raise exception 'invalid_days'; end if;
  update public.entitlements
     set expires_at = greatest(coalesce(expires_at, now()), now()) + make_interval(days => p_days), status = 'active'
   where id = p_id and status <> 'revoked';
end $$;

create or replace function public.admin_grant_plan(p_user uuid, p_plan text, p_days int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare plan public.ai_plans; w public.credit_wallets;
begin
  perform public.require_permission('access.grant');
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into plan from public.ai_plans where code = p_plan;
  if not found or plan.code = 'free' then raise exception 'invalid_plan'; end if;
  insert into public.ai_subscriptions(user_id, plan_code, source, starts_at, ends_at, granted_by, reason)
  values (p_user, plan.code, 'admin_grant', now(), now() + make_interval(days => coalesce(p_days, plan.period_days)), auth.uid(), p_reason);
  w := public._wallet_lock(p_user);
  update public.credit_wallets set plan_code = plan.code, balance = w.balance + plan.monthly_credits,
         period_start = now(), period_end = now() + make_interval(days => least(coalesce(p_days, plan.period_days), plan.period_days)),
         images_used = 0, web_searches_used = 0, video_searches_used = 0
   where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id, delta, balance_after, reason, actor_id, note)
  values (p_user, plan.monthly_credits, w.balance, 'admin_adjustment', auth.uid(), 'Complimentary ' || plan.name || ': ' || p_reason);
end $$;

create or replace function public.admin_adjust_credits(p_user uuid, p_delta int, p_reason text)
returns int language plpgsql security definer set search_path = public as $$
declare w public.credit_wallets;
begin
  perform public.require_permission('access.grant');
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  if p_delta = 0 or abs(p_delta) > 100000 then raise exception 'invalid_delta'; end if;
  w := public._wallet_lock(p_user);
  if w.balance + p_delta < 0 then raise exception 'balance_would_be_negative'; end if;
  update public.credit_wallets set balance = balance + p_delta where user_id = p_user returning * into w;
  insert into public.credit_ledger(user_id, delta, balance_after, reason, actor_id, note)
  values (p_user, p_delta, w.balance, 'admin_adjustment', auth.uid(), p_reason);
  perform public.audit('CREDITS', 'credit_wallets', p_user::text, null, jsonb_build_object('delta', p_delta), p_reason);
  return w.balance;
end $$;

-- ---------- Payments -------------------------------------------------
-- Records a refund done in the Paystack dashboard and removes the access it bought.
create or replace function public.admin_record_refund(p_payment uuid, p_reason text, p_amount_kobo int default null)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.payments;
begin
  perform public.require_permission('payments.manage');
  if coalesce(trim(p_reason), '') = '' then raise exception 'reason_required'; end if;
  select * into pay from public.payments where id = p_payment for update;
  if not found or pay.status <> 'success' then raise exception 'only_successful_payments_can_be_refunded'; end if;
  insert into public.refunds(payment_id, amount_kobo, reason, status, processed_by)
  values (pay.id, coalesce(p_amount_kobo, pay.amount_kobo), p_reason, 'recorded', auth.uid());
  update public.payments set status = 'refunded' where id = pay.id;
  update public.entitlements set status = 'revoked', reason = coalesce(reason, '') || ' | refunded' where payment_id = pay.id;
  update public.ai_subscriptions set status = 'cancelled', reason = coalesce(reason, '') || ' | refunded' where payment_id = pay.id;
end $$;

-- ---------- Notifications --------------------------------------------
create or replace function public.admin_broadcast(p_title text, p_body text, p_link text default null, p_programme text default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_permission('notifications.send');
  insert into public.notifications(user_id, title, body, link)
  select p.id, left(p_title, 200), left(p_body, 2000), p_link from public.profiles p
    left join public.programmes pr on pr.id = p.programme_id
   where p.status = 'active' and (p_programme is null or pr.code = p_programme);
  get diagnostics n = row_count;
  perform public.audit('BROADCAST', 'notifications', null, null, jsonb_build_object('title', p_title, 'recipients', n, 'programme', p_programme));
  return n;
end $$;

-- ---------- AI usage analytics ---------------------------------------
create or replace function public.admin_ai_usage(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_permission('ai.manage');
  return jsonb_build_object(
    'by_day', coalesce((select jsonb_agg(to_jsonb(x) order by x.day) from (
        select created_at::date as day, count(*) requests, count(*) filter (where status = 'refunded') failures,
               coalesce(sum(credits_charged), 0) credits, coalesce(round(sum(est_cost_usd), 4), 0) cost_usd
          from public.ai_requests where created_at > now() - make_interval(days => p_days) group by 1) x), '[]'),
    'by_action', coalesce((select jsonb_agg(to_jsonb(x) order by x.requests desc) from (
        select action, count(*) requests, count(*) filter (where status = 'refunded') failures,
               coalesce(sum(credits_charged), 0) credits, coalesce(round(sum(est_cost_usd), 4), 0) cost_usd,
               round(avg(latency_ms)) avg_latency_ms
          from public.ai_requests where created_at > now() - make_interval(days => p_days) group by 1) x), '[]'),
    'recent_errors', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'action', action, 'error', error_code,
                       'model', model, 'created_at', created_at) order by created_at desc)
                       from (select * from public.ai_requests where status = 'refunded' order by created_at desc limit 20) e), '[]'));
end $$;
