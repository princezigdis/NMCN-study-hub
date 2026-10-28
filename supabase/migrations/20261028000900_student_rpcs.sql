-- =====================================================================
-- 0900 STUDENT-FACING SERVER LOGIC
-- New-user bootstrap, library reader/search, practice engine (B),
-- exam engine (C/D) with server-side timing + scoring, stations (Paper 4),
-- personal dashboard (E).
-- =====================================================================

-- ---------- New user bootstrap ----------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120))
  on conflict (id) do nothing;
  insert into public.credit_wallets(user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create or replace trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email on auth.users;
create or replace trigger on_auth_user_email after update of email on auth.users
  for each row execute function public.handle_user_email_change();

create or replace function public.touch_last_active()
returns void language sql security definer set search_path = public as $$
  update public.profiles set last_active_at = now()
   where id = auth.uid() and (last_active_at is null or last_active_at < now() - interval '5 minutes');
$$;

-- ---------- Section A: reader & search ---------------------------------
-- Staff with content permissions may preview any version (p_version).
create or replace function public.note_reader(p_note uuid, p_version uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user();
  n public.notes; v public.note_versions;
  is_editor boolean := public.has_permission('content.manage') or public.has_permission('content.review');
begin
  select * into n from public.notes where id = p_note;
  if not found then raise exception 'note_not_found'; end if;
  if p_version is not null and is_editor then
    select * into v from public.note_versions where id = p_version and note_id = p_note;
  else
    if n.status <> 'published' and not is_editor then raise exception 'note_not_found'; end if;
    select * into v from public.note_versions where id = n.current_version_id;
  end if;
  if v.id is null then raise exception 'note_has_no_published_version'; end if;

  return jsonb_build_object(
    'note', jsonb_build_object('id', n.id, 'title', n.title, 'kind', n.kind, 'downloadable', n.downloadable,
                               'is_demo', n.is_demo, 'status', n.status),
    'version', jsonb_build_object('id', v.id, 'version', v.version, 'body_md', v.body_md,
                                  'source_reference', v.source_reference, 'reviewed_at', v.reviewed_at,
                                  'review_due_at', v.review_due_at, 'status', v.status,
                                  'is_preview', v.id is distinct from n.current_version_id),
    'breadcrumb', (select jsonb_build_object('topic_id', t.id, 'topic', t.title, 'module', m.title,
                                             'course_id', c.id, 'course', c.title, 'course_code', c.code)
                     from public.topics t join public.modules m on m.id = t.module_id
                     join public.courses c on c.id = m.course_id where t.id = n.topic_id),
    'references', coalesce((select jsonb_agg(jsonb_build_object('citation', r.citation, 'url', r.url) order by r.position)
                              from public.note_references r where r.note_id = n.id), '[]'),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name,
                               'mime_type', a.mime_type, 'size_bytes', a.size_bytes, 'storage_path', a.storage_path,
                               'downloadable', a.downloadable and n.downloadable))
                               from public.note_attachments a where a.note_id = n.id), '[]'),
    'related_question_count', (select count(*) from public.questions q
                                where q.topic_id = n.topic_id and q.bank = 'practice' and q.status = 'published'),
    'bookmarked', exists (select 1 from public.bookmarks b where b.user_id = uid and b.note_id = n.id),
    'progress', (select percent from public.reading_progress where user_id = uid and note_id = n.id),
    'highlights', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'quote', h.quote, 'color', h.color,
                              'comment', h.comment) order by h.created_at)
                              from public.highlights h where h.user_id = uid and h.note_id = n.id), '[]')
  );
end $$;

create or replace function public.note_progress(p_note uuid, p_percent int)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); v_pct int := greatest(0, least(100, p_percent));
begin
  if not exists (select 1 from public.notes where id = p_note and status = 'published') then return; end if;
  insert into public.reading_progress(user_id, note_id, percent, completed, last_viewed_at)
  values (uid, p_note, v_pct, v_pct >= 90, now())
  on conflict (user_id, note_id) do update
    set percent = greatest(public.reading_progress.percent, excluded.percent),
        completed = public.reading_progress.completed or excluded.completed,
        last_viewed_at = now();
  if not exists (select 1 from public.study_activity where user_id = uid and kind = 'note_read'
                  and ref_id = p_note and created_at >= date_trunc('day', now())) then
    insert into public.study_activity(user_id, kind, ref_id) values (uid, 'note_read', p_note);
  end if;
end $$;

create or replace function public.search_notes(p_query text, p_programme text default null, p_limit int default 20)
returns table(note_id uuid, title text, topic text, course text, snippet text, rank real)
language plpgsql stable security definer set search_path = public as $$
declare q tsquery;
begin
  perform public.require_active_user();
  if coalesce(trim(p_query), '') = '' then return; end if;
  q := websearch_to_tsquery('english', left(p_query, 200));
  return query
  select n.id, n.title, t.title, c.title,
         ts_headline('english', v.body_md, q, 'MaxFragments=2, MaxWords=25, MinWords=8, StartSel=**, StopSel=**'),
         (ts_rank(v.search, q) + case when n.title ilike '%' || p_query || '%' then 1 else 0 end)::real as r
    from public.notes n
    join public.note_versions v on v.id = n.current_version_id
    join public.topics t on t.id = n.topic_id
    join public.modules m on m.id = t.module_id
    join public.courses c on c.id = m.course_id
   where n.status = 'published' and c.status = 'published'
     and (v.search @@ q or n.title ilike '%' || p_query || '%' or t.title ilike '%' || p_query || '%')
     and (p_programme is null or exists (select 1 from public.course_programmes cp join public.programmes p on p.id = cp.programme_id
                                          where cp.course_id = c.id and p.code = p_programme))
   order by r desc
   limit least(greatest(p_limit, 1), 50);
end $$;

-- ---------- Shared: answer feedback (internal only) --------------------
create or replace function public._question_feedback(p_question uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'correct_option_id', (select id from public.question_options where question_id = p_question and is_correct limit 1),
    'source_reference', (select source_reference from public.questions where id = p_question),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label, 'body', o.body,
                          'is_correct', o.is_correct, 'rationale', o.rationale) order by o.label)
                          from public.question_options o where o.question_id = p_question), '[]'));
$$;

create or replace function public._question_public(p_question uuid, p_option_order uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'question_id', q.id, 'stem', q.stem, 'scenario', q.clinical_scenario, 'image_path', q.image_path,
    'difficulty', q.difficulty, 'topic_id', q.topic_id, 'topic', t.title, 'is_demo', q.is_demo,
    'options', coalesce((
       select jsonb_agg(jsonb_build_object('id', o.id, 'body', o.body,
                        'label', case when p_option_order is null then o.label
                                      else chr(64 + array_position(p_option_order, o.id)) end)
              order by coalesce(array_position(p_option_order, o.id), 0), o.label)
         from public.question_options o where o.question_id = q.id), '[]'))
  from public.questions q left join public.topics t on t.id = q.topic_id
  where q.id = p_question;
$$;

-- ---------- Section B: practice engine --------------------------------
create or replace function public.practice_start(
  p_count int, p_programme text default null, p_course uuid default null, p_topic uuid default null,
  p_difficulty public.difficulty_level default null, p_mode text default 'random')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user();
  v_ids uuid[]; v_session uuid;
begin
  if p_count not in (10, 20, 25, 50, 100) then raise exception 'invalid_count'; end if;
  if p_mode not in ('random','retry_incorrect','saved') then raise exception 'invalid_mode'; end if;

  select array_agg(id) into v_ids from (
    select q.id from public.questions q
     where q.bank = 'practice' and q.status = 'published'
       and (p_programme is null or exists (
             select 1 from public.question_programmes qp join public.programmes pr on pr.id = qp.programme_id
              where qp.question_id = q.id and pr.code = p_programme))
       and (p_course is null or q.course_id = p_course or q.topic_id in (
             select t.id from public.topics t join public.modules m on m.id = t.module_id where m.course_id = p_course))
       and (p_topic is null or q.topic_id in (
             select t.id from public.topics t where t.id = p_topic or t.parent_topic_id = p_topic))
       and (p_difficulty is null or q.difficulty = p_difficulty)
       and (p_mode <> 'saved' or exists (
             select 1 from public.bookmarks b where b.user_id = uid and b.question_id = q.id))
       and (p_mode <> 'retry_incorrect' or q.id in (
             select x.question_id from (
               select distinct on (pi.question_id) pi.question_id, pi.is_correct
                 from public.practice_items pi join public.practice_sessions ps on ps.id = pi.session_id
                where ps.user_id = uid and pi.answered_at is not null
                order by pi.question_id, pi.answered_at desc) x
             where x.is_correct = false))
     order by random()
     limit p_count) s;

  if v_ids is null then raise exception 'no_questions_available'; end if;

  insert into public.practice_sessions(user_id, mode, filters, question_count)
  values (uid, p_mode, jsonb_strip_nulls(jsonb_build_object('programme', p_programme, 'course_id', p_course,
          'topic_id', p_topic, 'difficulty', p_difficulty, 'requested', p_count)), array_length(v_ids, 1))
  returning id into v_session;

  insert into public.practice_items(session_id, position, question_id)
  select v_session, u.ord, u.qid from unnest(v_ids) with ordinality as u(qid, ord);

  return jsonb_build_object('session_id', v_session, 'question_count', array_length(v_ids, 1), 'requested', p_count);
end $$;

create or replace function public.practice_get(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); s public.practice_sessions;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = uid;
  if not found then raise exception 'session_not_found'; end if;
  return jsonb_build_object(
    'session', to_jsonb(s),
    'items', coalesce((
      select jsonb_agg(public._question_public(pi.question_id)
               || jsonb_build_object('position', pi.position, 'selected_option_id', pi.selected_option_id,
                                     'is_correct', pi.is_correct,
                                     'bookmarked', exists (select 1 from public.bookmarks b where b.user_id = uid and b.question_id = pi.question_id),
                                     'feedback', case when pi.answered_at is not null then public._question_feedback(pi.question_id) end)
               order by pi.position)
        from public.practice_items pi where pi.session_id = s.id), '[]'));
end $$;

create or replace function public.practice_answer(p_session uuid, p_position int, p_option uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user();
  s public.practice_sessions; it public.practice_items; v_correct boolean;
begin
  select * into s from public.practice_sessions where id = p_session and user_id = uid for update;
  if not found then raise exception 'session_not_found'; end if;
  select * into it from public.practice_items where session_id = p_session and position = p_position for update;
  if not found then raise exception 'item_not_found'; end if;
  if it.answered_at is not null then
    return jsonb_build_object('is_correct', it.is_correct, 'already_answered', true,
                              'feedback', public._question_feedback(it.question_id));
  end if;
  select is_correct into v_correct from public.question_options where id = p_option and question_id = it.question_id;
  if not found then raise exception 'invalid_option'; end if;

  update public.practice_items set selected_option_id = p_option, is_correct = v_correct, answered_at = now()
   where session_id = p_session and position = p_position;
  update public.practice_sessions set
    answered_count = answered_count + 1,
    correct_count = correct_count + v_correct::int,
    status = case when answered_count + 1 >= question_count then 'completed' else status end,
    completed_at = case when answered_count + 1 >= question_count then now() else completed_at end
   where id = p_session;
  insert into public.study_activity(user_id, kind, ref_id) values (uid, 'question_answered', it.question_id);

  return jsonb_build_object('is_correct', v_correct, 'feedback', public._question_feedback(it.question_id));
end $$;

create or replace function public.practice_finish(p_session uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  update public.practice_sessions set status = 'completed', completed_at = coalesce(completed_at, now())
   where id = p_session and user_id = uid;
end $$;

-- ---------- Sections C & D: exam engine --------------------------------
create or replace function public._exam_finalize(p_attempt uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_score int; v_total int; v_user uuid;
begin
  update public.exam_attempt_items i
     set is_correct = coalesce((select o.is_correct from public.question_options o where o.id = i.selected_option_id), false)
   where i.attempt_id = p_attempt;
  select count(*) filter (where is_correct), count(*) into v_score, v_total
    from public.exam_attempt_items where attempt_id = p_attempt;
  update public.exam_attempts set status = p_status, submitted_at = now(), score = v_score, total = v_total,
         percent = case when v_total > 0 then round(100.0 * v_score / v_total, 2) end
   where id = p_attempt and status = 'in_progress'
   returning user_id into v_user;
  if v_user is not null then
    insert into public.study_activity(user_id, kind, ref_id) values (v_user, 'exam_submitted', p_attempt);
  end if;
end $$;

create or replace function public.exam_start(p_paper uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user();
  p record; a public.exam_attempts; v_ids uuid[]; v_att uuid; v_product text; v_used int;
begin
  select ep.*, ec.section, ec.status as config_status, ec.max_attempts
    into p from public.exam_papers ep join public.exam_configs ec on ec.id = ep.config_id where ep.id = p_paper;
  if not found or (p.config_status <> 'published' and not public.has_permission('exams.manage')) then
    raise exception 'exam_not_available';
  end if;
  if p.kind <> 'objective' then raise exception 'not_an_objective_paper'; end if;

  v_product := case p.section when 'C' then 'section_c' else 'section_d' end;
  if not public.user_has_entitlement(uid, v_product) and not public.has_permission('exams.manage') then
    raise exception 'payment_required:%', v_product;
  end if;

  -- Resume an open attempt (connection drops, refreshes, device change).
  select * into a from public.exam_attempts where user_id = uid and paper_id = p_paper and status = 'in_progress';
  if found then
    if a.deadline_at > now() then
      return jsonb_build_object('attempt_id', a.id, 'resumed', true);
    end if;
    perform public._exam_finalize(a.id, 'expired');
  end if;

  if p.max_attempts is not null then
    select count(*) into v_used from public.exam_attempts where user_id = uid and paper_id = p_paper;
    if v_used >= p.max_attempts then raise exception 'max_attempts_reached'; end if;
  end if;

  select array_agg(id) into v_ids from (
    select q.id from public.question_pool_items pi join public.questions q on q.id = pi.question_id
     where pi.pool_id = p.pool_id and q.status = 'published'
       and q.bank = (case p.section when 'C' then 'section_c' else 'section_d' end)::public.question_bank
     order by random() limit p.question_count) s;
  if v_ids is null then raise exception 'no_questions_in_pool'; end if;

  insert into public.exam_attempts(user_id, paper_id, deadline_at, total)
  values (uid, p_paper, now() + make_interval(mins => p.duration_minutes), array_length(v_ids, 1))
  returning id into v_att;

  insert into public.exam_attempt_items(attempt_id, position, question_id, option_order)
  select v_att, u.ord, u.qid,
         (select array_agg(o.id order by case when p.shuffle_options then random() else 0 end, o.label)
            from public.question_options o where o.question_id = u.qid)
    from unnest(v_ids) with ordinality as u(qid, ord);

  return jsonb_build_object('attempt_id', v_att, 'resumed', false);
end $$;

create or replace function public.exam_result(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.exam_attempts; p public.exam_papers;
begin
  select * into a from public.exam_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then raise exception 'attempt_in_progress'; end if;
  select * into p from public.exam_papers where id = a.paper_id;
  return jsonb_build_object(
    'score', a.score, 'total', a.total, 'percent', a.percent, 'status', a.status,
    'pass_mark_percent', p.pass_mark_percent,
    'passed', case when p.pass_mark_percent is null then null else a.percent >= p.pass_mark_percent end,
    'answered', (select count(*) from public.exam_attempt_items where attempt_id = a.id and selected_option_id is not null),
    'by_topic', coalesce((
      select jsonb_agg(jsonb_build_object('topic', coalesce(t.title, 'Uncategorised'), 'correct', x.c, 'total', x.n,
                                          'percent', round(100.0 * x.c / x.n, 1)) order by (x.c::numeric / x.n))
        from (select q.topic_id, count(*) filter (where i.is_correct) c, count(*) n
                from public.exam_attempt_items i join public.questions q on q.id = i.question_id
               where i.attempt_id = a.id group by q.topic_id) x
        left join public.topics t on t.id = x.topic_id), '[]'));
end $$;

create or replace function public.exam_get(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user();
  a public.exam_attempts; p public.exam_papers; c public.exam_configs; v_review boolean;
begin
  select * into a from public.exam_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' and now() > a.deadline_at + interval '10 seconds' then
    perform public._exam_finalize(a.id, 'expired');
    select * into a from public.exam_attempts where id = p_attempt;
  end if;
  select * into p from public.exam_papers where id = a.paper_id;
  select * into c from public.exam_configs where id = p.config_id;
  v_review := a.status <> 'in_progress' and p.review_policy = 'after_submit';
  update public.exam_attempts set last_seen_at = now() where id = a.id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'status', a.status, 'started_at', a.started_at,
                                  'deadline_at', a.deadline_at, 'submitted_at', a.submitted_at,
                                  'score', a.score, 'total', a.total, 'percent', a.percent),
    'server_now', now(),
    'paper', jsonb_build_object('id', p.id, 'title', p.title, 'paper_number', p.paper_number,
                                'duration_minutes', p.duration_minutes, 'instructions', p.instructions,
                                'review_policy', p.review_policy, 'pass_mark_percent', p.pass_mark_percent),
    'config', jsonb_build_object('id', c.id, 'title', c.title, 'section', c.section, 'is_demo', c.is_demo),
    'review_available', v_review,
    'result', case when a.status <> 'in_progress' then public.exam_result(a.id) end,
    'items', coalesce((
      select jsonb_agg(public._question_public(i.question_id, i.option_order)
               || jsonb_build_object('position', i.position, 'selected_option_id', i.selected_option_id,
                                     'flagged', i.flagged)
               || case when v_review then jsonb_build_object('is_correct', i.is_correct,
                                                              'feedback', public._question_feedback(i.question_id))
                       else '{}'::jsonb end
               order by i.position)
        from public.exam_attempt_items i where i.attempt_id = a.id), '[]'));
end $$;

create or replace function public.exam_save_answer(p_attempt uuid, p_position int, p_option uuid, p_flagged boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.exam_attempts; it public.exam_attempt_items;
begin
  select * into a from public.exam_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status <> 'in_progress' then raise exception 'attempt_closed'; end if;
  if now() > a.deadline_at + interval '10 seconds' then
    perform public._exam_finalize(a.id, 'expired');
    return jsonb_build_object('saved', false, 'error', 'time_up');
  end if;
  select * into it from public.exam_attempt_items where attempt_id = p_attempt and position = p_position;
  if not found then raise exception 'item_not_found'; end if;
  if p_option is not null and not (p_option = any(it.option_order)) then raise exception 'invalid_option'; end if;

  update public.exam_attempt_items set
    selected_option_id = p_option,
    answered_at = case when p_option is null then null else now() end,
    flagged = coalesce(p_flagged, flagged)
   where attempt_id = p_attempt and position = p_position;
  update public.exam_attempts set last_seen_at = now() where id = p_attempt;
  return jsonb_build_object('saved', true,
    'answered', (select count(*) from public.exam_attempt_items where attempt_id = p_attempt and selected_option_id is not null));
end $$;

create or replace function public.exam_submit(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.exam_attempts;
begin
  select * into a from public.exam_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' then
    perform public._exam_finalize(a.id, case when now() > a.deadline_at + interval '10 seconds' then 'expired' else 'submitted' end);
  end if;
  return public.exam_result(p_attempt);
end $$;

-- Catalogue of exam configs for a section, with my access + attempt info.
create or replace function public.exam_catalogue(p_section text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); v_product text;
begin
  if p_section not in ('C','D') then raise exception 'invalid_section'; end if;
  v_product := case p_section when 'C' then 'section_c' else 'section_d' end;
  return jsonb_build_object(
    'has_access', public.user_has_entitlement(uid, v_product) or public.has_permission('exams.manage'),
    'product', (select jsonb_build_object('code', code, 'name', name, 'price_kobo', price_kobo,
                                          'access_days', access_days, 'description', description)
                  from public.products where code = v_product and active),
    'entitlement', (select jsonb_build_object('expires_at', expires_at, 'source', source)
                      from public.entitlements where user_id = uid and product_code = v_product and status = 'active'
                       and (expires_at is null or expires_at > now()) order by expires_at desc nulls first limit 1),
    'configs', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'description', c.description,
              'instructions', c.instructions, 'is_demo', c.is_demo, 'max_attempts', c.max_attempts,
              'programme', (select code from public.programmes where id = c.programme_id),
              'papers', coalesce((
                 select jsonb_agg(jsonb_build_object('id', p.id, 'paper_number', p.paper_number, 'title', p.title,
                        'kind', p.kind, 'question_count', p.question_count, 'duration_minutes', p.duration_minutes,
                        'pass_mark_percent', p.pass_mark_percent,
                        'attempts_used', (select count(*) from public.exam_attempts ea where ea.paper_id = p.id and ea.user_id = uid),
                        'open_attempt_id', (select ea.id from public.exam_attempts ea where ea.paper_id = p.id and ea.user_id = uid
                                              and ea.status = 'in_progress' and ea.deadline_at > now()),
                        'best_percent', (select max(percent) from public.exam_attempts ea where ea.paper_id = p.id and ea.user_id = uid),
                        'station_count', (select count(*) from public.exam_paper_stations s where s.paper_id = p.id))
                        order by p.paper_number)
                   from public.exam_papers p where p.config_id = c.id), '[]'))
              order by c.position, c.created_at)
        from public.exam_configs c where c.section = p_section and c.status = 'published'), '[]'),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', ea.id, 'paper', p.title, 'paper_number', p.paper_number,
              'config', c.title, 'status', ea.status, 'percent', ea.percent, 'score', ea.score, 'total', ea.total,
              'started_at', ea.started_at, 'submitted_at', ea.submitted_at) order by ea.started_at desc)
        from public.exam_attempts ea join public.exam_papers p on p.id = ea.paper_id
        join public.exam_configs c on c.id = p.config_id
       where ea.user_id = uid and c.section = p_section), '[]'));
end $$;

-- ---------- Paper 4: viva & CAOSCE practice ----------------------------
create or replace function public._station_access(p_uid uuid, s public.clinical_stations)
returns boolean language sql stable security definer set search_path = public as $$
  select (s.status = 'published' or public.has_permission('exams.manage'))
     and (s.bank = 'practice' or public.has_permission('exams.manage')
          or public.user_has_entitlement(p_uid, public.bank_product(s.bank)));
$$;

create or replace function public.paper_stations(p_paper uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); v_section text;
begin
  select c.section into v_section from public.exam_papers p join public.exam_configs c on c.id = p.config_id where p.id = p_paper;
  if v_section is null then raise exception 'paper_not_found'; end if;
  if not public.user_has_entitlement(uid, case v_section when 'C' then 'section_c' else 'section_d' end)
     and not public.has_permission('exams.manage') then
    raise exception 'payment_required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind,
             'duration_minutes', s.duration_minutes, 'is_demo', s.is_demo,
             'attempts', (select count(*) from public.station_attempts sa where sa.station_id = s.id and sa.user_id = uid))
             order by ps.position)
      from public.exam_paper_stations ps join public.clinical_stations s on s.id = ps.station_id
     where ps.paper_id = p_paper and s.status = 'published'), '[]');
end $$;

create or replace function public.station_get(p_station uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); s public.clinical_stations;
begin
  select * into s from public.clinical_stations where id = p_station;
  if not found or not public._station_access(uid, s) then raise exception 'station_not_available'; end if;
  return jsonb_build_object(
    'id', s.id, 'title', s.title, 'kind', s.kind, 'scenario', s.scenario,
    'candidate_instructions', s.candidate_instructions, 'duration_minutes', s.duration_minutes,
    'is_demo', s.is_demo, 'source_reference', s.source_reference,
    'checklist_count', (select count(*) from public.station_checklist_items where station_id = s.id),
    'viva_questions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'prompt', v.prompt, 'marks', v.marks)
                                 order by v.position) from public.station_viva_questions v where v.station_id = s.id), '[]'));
end $$;

create or replace function public._station_rubric(p_station uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'examiner_notes', (select examiner_notes from public.clinical_stations where id = p_station),
    'checklist', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'step', c.step, 'points', c.points,
                            'is_critical', c.is_critical) order by c.position)
                            from public.station_checklist_items c where c.station_id = p_station), '[]'),
    'viva', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'prompt', v.prompt,
                       'expected_points', v.expected_points, 'marks', v.marks) order by v.position)
                       from public.station_viva_questions v where v.station_id = p_station), '[]'));
$$;

create or replace function public.station_submit(p_station uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); s public.clinical_stations; v_id uuid; v_max numeric;
begin
  select * into s from public.clinical_stations where id = p_station;
  if not found or not public._station_access(uid, s) then raise exception 'station_not_available'; end if;
  if jsonb_typeof(coalesce(p_answers, '{}')) <> 'object' or length(p_answers::text) > 30000 then
    raise exception 'invalid_answers';
  end if;
  select coalesce((select sum(points) from public.station_checklist_items where station_id = s.id), 0)
       + coalesce((select sum(marks) from public.station_viva_questions where station_id = s.id), 0) into v_max;
  insert into public.station_attempts(user_id, station_id, viva_answers, max_score)
  values (uid, s.id, coalesce(p_answers, '{}'), v_max) returning id into v_id;
  return jsonb_build_object('attempt_id', v_id, 'max_score', v_max, 'rubric', public._station_rubric(s.id));
end $$;

-- Self-assessment against the revealed rubric. p_viva_marks: { viva_id: marks_awarded }
create or replace function public.station_self_assess(p_attempt uuid, p_ticks uuid[], p_viva_marks jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.station_attempts; v_score numeric; v_crit_missed int;
begin
  select * into a from public.station_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  select coalesce(sum(points), 0) into v_score from public.station_checklist_items
   where station_id = a.station_id and id = any(coalesce(p_ticks, '{}'));
  v_score := v_score + coalesce((
    select sum(least(greatest(coalesce((p_viva_marks->>v.id::text)::numeric, 0), 0), v.marks))
      from public.station_viva_questions v where v.station_id = a.station_id), 0);
  select count(*) into v_crit_missed from public.station_checklist_items
   where station_id = a.station_id and is_critical and not (id = any(coalesce(p_ticks, '{}')));
  update public.station_attempts set checklist_ticks = coalesce(p_ticks, '{}'), self_score = v_score where id = a.id;
  return jsonb_build_object('self_score', v_score, 'max_score', a.max_score, 'critical_missed', v_crit_missed);
end $$;

-- ---------- Section E: personal dashboard ------------------------------
create or replace function public.my_topic_stats()
returns table(topic_id uuid, topic text, course text, answered bigint, correct bigint, accuracy numeric)
language sql stable security definer set search_path = public as $$
  with answers as (
    select pi.question_id, pi.is_correct from public.practice_items pi
      join public.practice_sessions ps on ps.id = pi.session_id
     where ps.user_id = auth.uid() and pi.answered_at is not null
    union all
    select i.question_id, i.is_correct from public.exam_attempt_items i
      join public.exam_attempts a on a.id = i.attempt_id
     where a.user_id = auth.uid() and a.status <> 'in_progress'
  )
  select t.id, t.title, c.title, count(*), count(*) filter (where x.is_correct),
         round(100.0 * count(*) filter (where x.is_correct) / count(*), 1)
    from answers x join public.questions q on q.id = x.question_id
    join public.topics t on t.id = q.topic_id
    join public.modules m on m.id = t.module_id
    join public.courses c on c.id = m.course_id
   group by t.id, t.title, c.title;
$$;

create or replace function public.my_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); v_streak int := 0; d date := current_date;
begin
  -- Consecutive study days ending today (or yesterday, so the streak survives until tonight).
  if not exists (select 1 from public.study_activity where user_id = uid and created_at::date = d) then d := d - 1; end if;
  while exists (select 1 from public.study_activity where user_id = uid and created_at::date = d) loop
    v_streak := v_streak + 1; d := d - 1;
  end loop;

  return jsonb_build_object(
    'profile', (select jsonb_build_object('full_name', p.full_name, 'programme', pr.code, 'programme_name', pr.name,
                                          'exam_target_date', p.exam_target_date, 'institution', p.institution)
                  from public.profiles p left join public.programmes pr on pr.id = p.programme_id where p.id = uid),
    'streak_days', v_streak,
    'practice', (select jsonb_build_object('answered', count(*), 'correct', count(*) filter (where pi.is_correct))
                   from public.practice_items pi join public.practice_sessions ps on ps.id = pi.session_id
                  where ps.user_id = uid and pi.answered_at is not null),
    'last_7_days', coalesce((select jsonb_agg(jsonb_build_object('day', g.day::date, 'questions', coalesce(x.n, 0)) order by g.day)
                     from generate_series(current_date - 6, current_date, interval '1 day') as g(day)
                     left join (select created_at::date as day, sum(amount) n from public.study_activity
                                 where user_id = uid and kind = 'question_answered' and created_at >= current_date - 6
                                 group by 1) x on x.day = g.day::date), '[]'),
    'weak_topics', coalesce((select jsonb_agg(to_jsonb(s) order by s.accuracy asc, s.answered desc)
                     from (select * from public.my_topic_stats() where answered >= 3 order by accuracy asc, answered desc limit 5) s), '[]'),
    'strong_topics', coalesce((select jsonb_agg(to_jsonb(s) order by s.accuracy desc)
                     from (select * from public.my_topic_stats() where answered >= 3 order by accuracy desc limit 3) s), '[]'),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'period', g.period, 'metric', g.metric, 'target', g.target,
              'current', (select coalesce(case g.metric when 'notes' then count(distinct a.ref_id) else sum(a.amount) end, 0)
                            from public.study_activity a
                           where a.user_id = uid
                             and a.created_at >= case g.period when 'daily' then date_trunc('day', now()) else date_trunc('week', now()) end
                             and a.kind = case g.metric when 'questions' then 'question_answered' when 'notes' then 'note_read'
                                                        when 'flashcards' then 'flashcard_reviewed' else 'study_minutes' end)))
              from public.study_goals g where g.user_id = uid and g.active), '[]'),
    'flashcards_due', (select count(*) from public.flashcards where user_id = uid and due_at <= now()),
    'recent_notes', coalesce((select jsonb_agg(jsonb_build_object('note_id', n.id, 'title', n.title, 'percent', rp.percent,
                                'last_viewed_at', rp.last_viewed_at) order by rp.last_viewed_at desc)
                     from (select * from public.reading_progress where user_id = uid order by last_viewed_at desc limit 5) rp
                     join public.notes n on n.id = rp.note_id where n.status = 'published'), '[]'),
    'recent_practice', coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at desc)
                     from (select id, mode, question_count, answered_count, correct_count, status, started_at
                             from public.practice_sessions where user_id = uid order by started_at desc limit 5) s), '[]'),
    'exam_history', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'section', c.section, 'paper', p.title,
                                'config', c.title, 'percent', a.percent, 'status', a.status, 'started_at', a.started_at)
                                order by a.started_at desc)
                     from (select * from public.exam_attempts where user_id = uid order by started_at desc limit 10) a
                     join public.exam_papers p on p.id = a.paper_id join public.exam_configs c on c.id = p.config_id), '[]'),
    'readiness', (select jsonb_build_object('attempts', count(*), 'avg_percent', round(avg(percent), 1),
                    'label', case when count(*) = 0 then 'No Section D attempts yet'
                                  when avg(percent) >= 70 then 'On track in practice'
                                  when avg(percent) >= 50 then 'Developing' else 'Needs more practice' end)
                    from (select a.percent from public.exam_attempts a join public.exam_papers p on p.id = a.paper_id
                            join public.exam_configs c on c.id = p.config_id
                           where a.user_id = uid and c.section = 'D' and a.status <> 'in_progress'
                           order by a.submitted_at desc limit 3) r),
    'course_progress', coalesce((select jsonb_agg(jsonb_build_object('course_id', c.id, 'course', c.title,
              'notes_total', x.total, 'notes_done', x.done) order by c.position)
              from public.courses c
              join lateral (select count(*) total,
                                   count(*) filter (where exists (select 1 from public.reading_progress rp
                                                                   where rp.user_id = uid and rp.note_id = n.id and rp.completed)) done
                              from public.notes n join public.topics t on t.id = n.topic_id join public.modules m on m.id = t.module_id
                             where m.course_id = c.id and n.status = 'published') x on x.total > 0
             where c.status = 'published'
               and exists (select 1 from public.reading_progress rp join public.notes n2 on n2.id = rp.note_id
                             join public.topics t2 on t2.id = n2.topic_id join public.modules m2 on m2.id = t2.module_id
                            where rp.user_id = uid and m2.course_id = c.id)), '[]'),
    'entitlements', coalesce((select jsonb_agg(jsonb_build_object('product_code', e.product_code, 'expires_at', e.expires_at,
                                'source', e.source))
                     from public.entitlements e where e.user_id = uid and e.status = 'active'
                      and (e.expires_at is null or e.expires_at > now())), '[]'),
    'wallet', public.my_wallet(),
    'unread_notifications', (select count(*) from public.notifications where user_id = uid and read_at is null)
  );
end $$;
