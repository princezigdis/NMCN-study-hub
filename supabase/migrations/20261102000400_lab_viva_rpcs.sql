-- =====================================================================
-- 0400 VIVA — MEANING-BASED MARKING ENGINE + STUDENT RPCs
-- Marking is deterministic and server-side (no AI key needed). Answers are
-- normalised (British/American spelling, word endings, minor typos) and compared
-- with each key point AND its accepted alternative wordings, so a student who
-- says the right thing in different English still earns the mark. The marking
-- guide (model answer, key points, explanation) is returned with every result.
-- An AI examiner can later refine these results; it is not required.
-- =====================================================================

alter table public.viva_responses add column if not exists auto_score numeric not null default 0;

create or replace function public._lab_norm(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    lower(coalesce(t, '')), 'ae|oe', 'e', 'g'),
    'is(e|ed|es|ing|ation|ations)\y', 'iz\1', 'g'),
    'yse(s|d)?\y', 'yze\1', 'g'),
    '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function public._lab_tokens(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct s), '{}') from (
    select case
      when length(w) > 5 and w ~ 'ations?$' then regexp_replace(w, 'ations?$', '')
      when length(w) > 5 and w ~ 'ing$' then regexp_replace(w, 'ing$', '')
      when length(w) > 4 and w ~ 'ies$' then regexp_replace(w, 'ies$', 'y')
      when length(w) > 4 and w ~ 'es$' then regexp_replace(w, 'es$', '')
      when length(w) > 4 and w ~ 'ed$' then regexp_replace(w, 'ed$', '')
      when length(w) > 3 and w ~ 's$' and w !~ 'ss$' then regexp_replace(w, 's$', '')
      else w end as s
    from unnest(string_to_array(public._lab_norm(t), ' ')) w
    where w <> '' and w <> all (array['a','an','the','of','to','in','on','at','and','or','is','are','be','by','for','with','from',
      'that','this','it','as','will','would','can','should','may','i','you','my','her','his','she','he','they','their','we','our',
      'when','if','then','also','so','do','does','did','have','has','had','been','was','were'])
  ) x where length(s) >= 2;
$$;

-- Share of a phrase's meaningful words that appear in the answer (tolerating typos / word variants).
create or replace function public._lab_cover(p_ans text[], p_phrase text)
returns numeric language plpgsql stable as $$
declare pt text[] := public._lab_tokens(p_phrase); n int := coalesce(array_length(pt, 1), 0); m int := 0; w text; a text;
begin
  if n = 0 then return 0; end if;
  foreach w in array pt loop
    if w = any(p_ans) then m := m + 1;
    elsif length(w) >= 5 then
      foreach a in array p_ans loop
        if length(a) >= 5 and (similarity(a, w) >= 0.6 or (left(a, 5) = left(w, 5) and abs(length(a) - length(w)) <= 3)) then
          m := m + 1; exit;
        end if;
      end loop;
    end if;
  end loop;
  return m::numeric / n;
end $$;

-- 1 = full, 0.5 = partial, 0 = missed
create or replace function public._lab_point_credit(p_ans text[], p_point text, p_accepted text[])
returns numeric language plpgsql stable as $$
declare ph text; c numeric; n int; best numeric := 0;
begin
  foreach ph in array (array[p_point] || coalesce(p_accepted, '{}')) loop
    c := public._lab_cover(p_ans, ph);
    n := coalesce(array_length(public._lab_tokens(ph), 1), 0);
    if c >= 0.8 then best := 1; exit;
    elsif c >= 0.5 and n >= 2 then best := greatest(best, 0.5); end if;
  end loop;
  return best;
end $$;

-- Mark an answer against a viva question's key points. Returns the full marking breakdown.
create or replace function public._lab_mark(p_question uuid, p_answer text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q public.viva_questions; ans text[]; kp record; credit numeric; pts jsonb := '[]'; got numeric := 0; tot numeric := 0;
        score numeric; flags jsonb := '[]'; ph text;
begin
  select * into q from public.viva_questions where id = p_question;
  if not found then raise exception 'question_not_found'; end if;
  ans := public._lab_tokens(p_answer);
  for kp in select * from public.viva_key_points where question_id = p_question order by position loop
    credit := case when coalesce(array_length(ans, 1), 0) < 2 then 0 else public._lab_point_credit(ans, kp.point, kp.accepted) end;
    got := got + credit * kp.marks; tot := tot + kp.marks;
    pts := pts || jsonb_build_object('id', kp.id, 'point', kp.point, 'marks', kp.marks, 'is_critical', kp.is_critical,
             'status', case credit when 1 then 'hit' when 0.5 then 'partial' else 'missed' end);
  end loop;
  foreach ph in array q.unsafe_phrases loop
    if public._lab_cover(ans, ph) >= 0.8 then flags := flags || jsonb_build_object('type', 'unsafe', 'text', ph); end if;
  end loop;
  score := case when tot = 0 then 0 else round(got / tot * q.marks * 2) / 2 end;
  return jsonb_build_object('score', score, 'max', q.marks, 'points', pts, 'flags', flags);
end $$;

-- ---------- reads ----------------------------------------------------
create or replace function public.viva_examiners()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('style', style, 'label', label, 'intro', intro) order by style), '[]')
    from public.viva_examiner_settings where active;
$$;

create or replace function public.viva_cases_list(p_category uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'viva');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'intro', c.intro, 'difficulty', c.difficulty,
             'category', k.name, 'questions', (select count(*) from public.viva_questions q where q.case_id = c.id),
             'locked', not (acc or c.is_free_preview), 'free', c.is_free_preview,
             'best_percent', (select round(100 * max(r.score / nullif(r.max_score, 0)))
                                from public.viva_responses r join public.viva_questions q on q.id = r.question_id
                               where r.user_id = uid and q.case_id = c.id)) order by k.position, c.position, c.title)
      from public.viva_cases c join public.viva_categories k on k.id = c.category_id
     where c.status = 'published' and k.status = 'published' and public._lab_prog_ok(c.programme) and public._lab_prog_ok(k.programme)
       and (p_category is null or c.category_id = p_category)), '[]');
end $$;

create or replace function public.viva_home()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); prog text := public.my_programme_code(); acc boolean := public.lab_access(uid, 'viva');
begin
  return jsonb_build_object(
    'programme', prog, 'has_access', acc,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'group', k.group_name,
        'cases', (select count(*) from public.viva_cases c where c.category_id = k.id and c.status = 'published' and public._lab_prog_ok(c.programme))) order by k.position, k.name)
        from public.viva_categories k where k.status = 'published' and public._lab_prog_ok(k.programme)), '[]'),
    'stats', (select jsonb_build_object('sessions', count(*), 'completed', count(*) filter (where status <> 'in_progress'),
                'avg_percent', round(avg(100 * score / nullif(max_score, 0)) filter (where status <> 'in_progress')),
                'best_percent', round(max(100 * score / nullif(max_score, 0)) filter (where status <> 'in_progress')))
                from public.viva_attempts where user_id = uid),
    'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', id, 'mode', mode, 'status', status, 'started_at', started_at,
                'percent', round(100 * score / nullif(max_score, 0))) x from public.viva_attempts where user_id = uid
                order by started_at desc limit 5) s), '[]'),
    'daily', (select jsonb_build_object('id', c.id, 'title', c.title, 'category', k.name, 'locked', not (acc or c.is_free_preview))
                from public.viva_cases c join public.viva_categories k on k.id = c.category_id
               where c.status = 'published' and k.status = 'published' and public._lab_prog_ok(c.programme) and public._lab_prog_ok(k.programme)
               order by md5(c.id::text || current_date::text) limit 1));
end $$;

create or replace function public.viva_progress()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  return jsonb_build_object(
    'by_category', coalesce((select jsonb_agg(jsonb_build_object('category', name, 'answered', n, 'percent', pct) order by pct) from (
        select k.name, count(*) n, round(100 * sum(r.score) / nullif(sum(r.max_score), 0)) pct
          from public.viva_responses r join public.viva_questions q on q.id = r.question_id
          join public.viva_cases c on c.id = q.case_id join public.viva_categories k on k.id = c.category_id
         where r.user_id = uid group by k.name) t), '[]'),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'percent', pct) order by d) from (
        select date(submitted_at) d, round(avg(100 * score / nullif(max_score, 0))) pct from public.viva_attempts
         where user_id = uid and status <> 'in_progress' and max_score > 0 group by 1 order by 1 desc limit 14) t), '[]'),
    'missed_points', coalesce((select jsonb_agg(point) from (
        select kp.point from public.viva_responses r join public.viva_key_points kp on kp.id = any(r.missed_points)
         where r.user_id = uid group by kp.point order by count(*) desc limit 8) t), '[]'));
end $$;

-- ---------- attempts -------------------------------------------------
create or replace function public.viva_start(p_mode text, p_category uuid default null, p_count int default 3,
                                             p_style text default 'professional', p_case uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); prog text := public.my_programme_code(); acc boolean := public.lab_access(uid, 'viva');
        cases uuid[]; qids uuid[]; n int := least(greatest(coalesce(p_count, 3), 1), 8); v_id uuid; v_min int; locked_hit boolean;
begin
  if prog is null then raise exception 'programme_not_set'; end if;
  if p_mode not in ('learning','practice','mock','weakness') then raise exception 'invalid_mode'; end if;
  if not exists (select 1 from public.viva_examiner_settings where style = p_style and active) then p_style := 'professional'; end if;

  select array_agg(id) into cases from (
    select c.id from public.viva_cases c join public.viva_categories k on k.id = c.category_id
     where c.status = 'published' and k.status = 'published' and public._lab_prog_ok(c.programme) and public._lab_prog_ok(k.programme)
       and (acc or c.is_free_preview)
       and (p_case is null or c.id = p_case)
       and (p_category is null or c.category_id = p_category)
       and (p_mode <> 'weakness' or coalesce((select sum(r.score) / nullif(sum(r.max_score), 0) from public.viva_responses r
              join public.viva_questions q on q.id = r.question_id where r.user_id = uid and q.case_id = c.id), 1) < 0.6)
       and exists (select 1 from public.viva_questions q where q.case_id = c.id)
     order by case when p_mode = 'weakness' then coalesce((select sum(r.score) / nullif(sum(r.max_score), 0) from public.viva_responses r
              join public.viva_questions q on q.id = r.question_id where r.user_id = uid and q.case_id = c.id), 1) end nulls last, random()
     limit case when p_case is not null then 1 else n end) s;

  if cases is null then
    select exists (select 1 from public.viva_cases c where c.status = 'published' and not c.is_free_preview and public._lab_prog_ok(c.programme)) into locked_hit;
    if p_mode = 'weakness' then raise exception 'no_weak_topics'; end if;
    if locked_hit and not acc then raise exception 'payment_required'; end if;
    raise exception 'no_content';
  end if;

  select array_agg(q.id order by array_position(cases, q.case_id), q.position) into qids
    from public.viva_questions q where q.case_id = any(cases);
  v_min := ceil(coalesce(array_length(qids, 1), 1) * 2.5);
  insert into public.viva_attempts(user_id, mode, examiner_style, programme, category_id, question_ids, deadline_at)
  values (uid, p_mode, p_style, prog, p_category, qids, case when p_mode = 'mock' then now() + make_interval(mins => v_min) end)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public._viva_result(r public.viva_responses, show_guide boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q public.viva_questions;
begin
  select * into q from public.viva_questions where id = r.question_id;
  return jsonb_build_object('response_id', r.id, 'answer', r.answer, 'source', r.source, 'score', r.score, 'max', r.max_score,
    'flags', r.flags, 'self_points', r.self_points,
    'points', coalesce((select jsonb_agg(jsonb_build_object('id', kp.id, 'point', kp.point, 'marks', kp.marks, 'is_critical', kp.is_critical,
        'status', case when kp.id = any(r.hit_points) then 'hit' when kp.id = any(r.partial_points) then 'partial' else 'missed' end,
        'self', kp.id = any(r.self_points)) order by kp.position) from public.viva_key_points kp where kp.question_id = r.question_id), '[]'),
    'model_answer', case when show_guide then q.model_answer end,
    'explanation', case when show_guide then q.explanation end,
    'further_reading', case when show_guide then q.further_reading end);
end $$;

create or replace function public._viva_finalize(p_attempt uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare a public.viva_attempts;
begin
  select * into a from public.viva_attempts where id = p_attempt for update;
  if a.status <> 'in_progress' then return; end if;
  update public.viva_attempts set status = p_status, submitted_at = now(),
    score = coalesce((select sum(score) from public.viva_responses where attempt_id = a.id), 0),
    max_score = coalesce((select sum(marks) from public.viva_questions where id = any(a.question_ids)), 0)
   where id = a.id;
end $$;

create or replace function public.viva_get(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.viva_attempts; show boolean; ex public.viva_examiner_settings;
begin
  select * into a from public.viva_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status = 'in_progress' and a.deadline_at is not null and now() > a.deadline_at + interval '10 seconds' then
    perform public._viva_finalize(a.id, 'expired'); select * into a from public.viva_attempts where id = p_attempt;
  end if;
  show := a.mode <> 'mock' or a.status <> 'in_progress';
  select * into ex from public.viva_examiner_settings where style = a.examiner_style;
  return jsonb_build_object('id', a.id, 'mode', a.mode, 'status', a.status, 'examiner_style', a.examiner_style,
    'examiner', jsonb_build_object('label', ex.label, 'intro', ex.intro, 'praise', ex.praise, 'probe', ex.probe),
    'deadline_at', a.deadline_at, 'server_now', now(), 'score', a.score, 'max_score', a.max_score,
    'items', (select jsonb_agg(jsonb_build_object('id', q.id, 'prompt', q.prompt, 'marks', q.marks, 'case_id', c.id, 'case_title', c.title,
        'case_intro', case when q.position = (select min(position) from public.viva_questions where case_id = c.id) then c.intro end,
        'answered', r.id is not null,
        'result', case when r.id is not null and (show or a.mode <> 'mock') then public._viva_result(r, show) end)
        order by array_position(a.question_ids, q.id))
        from unnest(a.question_ids) with ordinality u(qid, ord)
        join public.viva_questions q on q.id = u.qid join public.viva_cases c on c.id = q.case_id
        left join public.viva_responses r on r.attempt_id = a.id and r.question_id = q.id));
end $$;

create or replace function public.viva_answer(p_attempt uuid, p_question uuid, p_answer text, p_source text default 'text')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.viva_attempts; m jsonb; r public.viva_responses; q public.viva_questions;
        hit uuid[]; part uuid[]; miss uuid[];
begin
  select * into a from public.viva_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if a.status <> 'in_progress' then raise exception 'attempt_closed'; end if;
  if a.deadline_at is not null and now() > a.deadline_at + interval '10 seconds' then
    perform public._viva_finalize(a.id, 'expired'); raise exception 'time_up';
  end if;
  if not (p_question = any(a.question_ids)) then raise exception 'question_not_in_attempt'; end if;
  p_answer := btrim(coalesce(p_answer, ''));
  if length(p_answer) < 2 then raise exception 'answer_empty'; end if;
  if length(p_answer) > 4000 then raise exception 'answer_too_long'; end if;
  if p_source not in ('text','voice') then p_source := 'text'; end if;
  if a.mode = 'mock' and exists (select 1 from public.viva_responses where attempt_id = a.id and question_id = p_question) then
    raise exception 'already_answered';
  end if;
  select * into q from public.viva_questions where id = p_question;
  m := public._lab_mark(p_question, p_answer);
  select coalesce(array_agg((x->>'id')::uuid) filter (where x->>'status' = 'hit'), '{}'),
         coalesce(array_agg((x->>'id')::uuid) filter (where x->>'status' = 'partial'), '{}'),
         coalesce(array_agg((x->>'id')::uuid) filter (where x->>'status' = 'missed'), '{}')
    into hit, part, miss from jsonb_array_elements(m->'points') x;
  insert into public.viva_responses(attempt_id, user_id, question_id, answer, source, score, auto_score, max_score, hit_points, partial_points, missed_points, flags)
  values (a.id, uid, p_question, p_answer, p_source, (m->>'score')::numeric, (m->>'score')::numeric, q.marks, hit, part, miss, m->'flags')
  on conflict (attempt_id, question_id) do update set answer = excluded.answer, source = excluded.source, score = excluded.score,
    auto_score = excluded.auto_score, hit_points = excluded.hit_points, partial_points = excluded.partial_points,
    missed_points = excluded.missed_points, self_points = '{}', flags = excluded.flags, created_at = now()
  returning * into r;
  if a.mode = 'mock' then return jsonb_build_object('saved', true); end if;
  return public._viva_result(r, true);
end $$;

-- Practice / learning only: the student may claim a point they believe they covered in different words.
create or replace function public.viva_self_adjust(p_response uuid, p_points uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); r public.viva_responses; a public.viva_attempts; q public.viva_questions;
        tot numeric; extra numeric;
begin
  select * into r from public.viva_responses where id = p_response and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  select * into a from public.viva_attempts where id = r.attempt_id;
  if a.mode = 'mock' then raise exception 'not_allowed_in_mock'; end if;
  select * into q from public.viva_questions where id = r.question_id;
  p_points := coalesce((select array_agg(k.id) from public.viva_key_points k where k.question_id = r.question_id and k.id = any(coalesce(p_points, '{}'))), '{}');
  select coalesce(sum(marks), 0) into tot from public.viva_key_points where question_id = r.question_id;
  select coalesce(sum(marks), 0) into extra from public.viva_key_points
   where id = any(p_points) and not (id = any(r.hit_points));
  update public.viva_responses set self_points = p_points,
    score = least(max_score, r.auto_score + case when tot = 0 then 0 else round(extra / tot * q.marks * 2) / 2 end)
   where id = r.id returning * into r;
  return public._viva_result(r, true);
end $$;

create or replace function public.viva_report(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.viva_attempts; g jsonb;
begin
  g := public.viva_get(p_attempt);
  select * into a from public.viva_attempts where id = p_attempt and user_id = uid;
  if a.status = 'in_progress' then raise exception 'attempt_not_finished'; end if;
  return g || jsonb_build_object('percent', round(100 * a.score / nullif(a.max_score, 0)),
    'critical_missed', (select count(*) from public.viva_responses r join public.viva_key_points k on k.id = any(r.missed_points)
                         where r.attempt_id = a.id and k.is_critical),
    'revise', coalesce((select jsonb_agg(distinct k.point) from public.viva_responses r join public.viva_key_points k on k.id = any(r.missed_points)
                         where r.attempt_id = a.id), '[]'),
    'disclaimer', 'Practice result only. This is not an official NMCN assessment and does not predict your examination result.');
end $$;

create or replace function public.viva_finish(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if not exists (select 1 from public.viva_attempts where id = p_attempt and user_id = uid) then raise exception 'attempt_not_found'; end if;
  perform public._viva_finalize(p_attempt, 'submitted');
  return public.viva_report(p_attempt);
end $$;

-- ---------- grants ---------------------------------------------------
revoke all on function public._lab_mark(uuid, text), public._viva_result(public.viva_responses, boolean), public._viva_finalize(uuid, text) from public, anon, authenticated;
grant execute on function public.viva_examiners(), public.viva_cases_list(uuid), public.viva_home(), public.viva_progress(),
  public.viva_start(text, uuid, int, text, uuid), public.viva_get(uuid), public.viva_answer(uuid, uuid, text, text),
  public.viva_self_adjust(uuid, uuid[]), public.viva_report(uuid), public.viva_finish(uuid) to authenticated;

insert into public.viva_examiner_settings(style, label, intro, praise, probe) values
  ('friendly', 'Friendly examiner', 'Welcome. Take your time, and answer in your own words. We will go one question at a time.', 'Well done, that is a good point.', 'Can you tell me a little more about that?'),
  ('professional', 'Professional examiner', 'Good day. I will ask you a series of questions. Please answer clearly and completely.', 'Thank you. That is correct.', 'Please expand on your answer.'),
  ('strict', 'Strict examiner', 'This is a formal oral examination. Answer precisely and justify your clinical decisions.', 'Acceptable.', 'That is incomplete. Justify your answer and state what you would do first.')
on conflict (style) do nothing;
