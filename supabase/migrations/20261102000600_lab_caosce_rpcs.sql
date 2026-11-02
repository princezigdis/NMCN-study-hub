-- =====================================================================
-- 0600 CAOSCE — student RPCs, exam engine (server-authoritative timing),
-- admin publishing / duplicate / reorder, analytics.
-- Students never read content tables directly; correct answers never leave the
-- server until an answer has been submitted (practice) or the exam is finished.
-- =====================================================================

-- ---------- procedure library ----------------------------------------
create or replace function public.caosce_library(p_category uuid default null, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'caosce');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name, 'category', k.name, 'category_id', k.id, 'programme', p.programme,
      'description', p.description, 'locked', not (acc or p.is_free_preview), 'free', p.is_free_preview,
      'stages_done', coalesce(cardinality(g.stages_done), 0), 'has_station', p.station_id is not null,
      'videos', (select count(*) from public.caosce_videos v where v.procedure_id = p.id and v.status = 'published'),
      'steps', (select count(*) from public.caosce_procedure_steps s where s.procedure_id = p.id))
      order by k.position nulls last, p.position, p.name)
    from public.caosce_procedures p
    left join public.caosce_categories k on k.id = p.category_id
    left join public.caosce_progress g on g.procedure_id = p.id and g.user_id = uid
   where p.status = 'published' and public._lab_prog_ok(p.programme) and (k.id is null or k.status = 'published')
     and (p_category is null or p.category_id = p_category)
     and (coalesce(p_q, '') = '' or p.name ilike '%' || p_q || '%' or p.code ilike '%' || p_q || '%')), '[]');
end $$;

create or replace function public.caosce_categories_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by position, name), '[]')
    from public.caosce_categories where status = 'published';
$$;

create or replace function public.caosce_procedure(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'caosce'); p public.caosce_procedures; staff boolean := public.lab_staff();
begin
  select * into p from public.caosce_procedures where id = p_id;
  if not found or (p.status <> 'published' and not staff) or not public._lab_prog_ok(p.programme) then raise exception 'procedure_not_available'; end if;
  if not (acc or p.is_free_preview) then raise exception 'payment_required'; end if;
  return jsonb_build_object(
    'id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'definition', p.definition, 'purpose', p.purpose,
    'anatomy', p.anatomy, 'objectives', p.objectives, 'indications', p.indications, 'contraindications', p.contraindications,
    'expected_outcomes', p.expected_outcomes, 'safety', p.safety, 'patient_prep', p.patient_prep,
    'references', p.source_references, 'reviewer', p.reviewer, 'reviewed_at', p.reviewed_at, 'version', p.version,
    'station_id', p.station_id, 'status', p.status,
    'steps', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'action', s.action, 'explanation', s.explanation,
        'rationale', s.rationale, 'safety', s.safety, 'common_mistake', s.common_mistake, 'expected_outcome', s.expected_outcome,
        'is_critical', s.is_critical) order by s.position) from public.caosce_procedure_steps s where s.procedure_id = p.id), '[]'),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'purpose', e.purpose, 'correct_use', e.correct_use,
        'precautions', e.precautions, 'image_path', e.image_path) order by pe.position)
        from public.caosce_procedure_equipment pe join public.caosce_equipment e on e.id = pe.equipment_id
       where pe.procedure_id = p.id and (e.status = 'published' or staff)), '[]'),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'image_path', x.image_path) order by random()) from (
        select e.id, e.name, e.image_path from public.caosce_equipment e
          join public.caosce_procedure_equipment pe on pe.equipment_id = e.id and pe.procedure_id = p.id where e.status = 'published'
        union all
        (select e.id, e.name, e.image_path from public.caosce_equipment e where e.status = 'published'
            and not exists (select 1 from public.caosce_procedure_equipment pe where pe.equipment_id = e.id and pe.procedure_id = p.id)
          order by random() limit 5)) x), '[]'),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'kind', v.kind, 'title', v.title, 'description', v.description,
        'duration_seconds', v.duration_seconds, 'thumbnail_path', v.thumbnail_path, 'chapters', v.chapters,
        'watched', coalesce(vp.position_seconds, 0), 'completed', coalesce(vp.completed, false))
        order by array_position(array['complete','step_by_step','mistakes','equipment','other'], v.kind))
        from public.caosce_videos v left join public.caosce_video_progress vp on vp.video_id = v.id and vp.user_id = uid
       where v.procedure_id = p.id and (v.status = 'published' or staff) and public._lab_prog_ok(v.programme)), '[]'),
    'exercises', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title) order by x.position)
        from public.caosce_exercises x where x.procedure_id = p.id and (x.status = 'published' or staff)), '[]'),
    'question_count', (select count(*) from public.caosce_questions q where q.procedure_id = p.id and q.status = 'published'),
    'progress', coalesce((select jsonb_build_object('stages_done', g.stages_done, 'steps_understood', g.steps_understood)
        from public.caosce_progress g where g.user_id = uid and g.procedure_id = p.id), jsonb_build_object('stages_done', '[]'::jsonb, 'steps_understood', '[]'::jsonb)));
end $$;

create or replace function public.caosce_video_get(p_video uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); v public.caosce_videos; p public.caosce_procedures;
begin
  select * into v from public.caosce_videos where id = p_video;
  if not found then raise exception 'video_not_available'; end if;
  select * into p from public.caosce_procedures where id = v.procedure_id;
  if (v.status <> 'published' and not public.lab_staff()) or not public._lab_prog_ok(v.programme)
     or not (public.lab_access(uid, 'caosce') or p.is_free_preview) then raise exception 'video_not_available'; end if;
  return jsonb_build_object('id', v.id, 'title', v.title, 'description', v.description, 'kind', v.kind,
    'storage_path', v.storage_path, 'external_url', v.external_url, 'captions_path', v.captions_path, 'thumbnail_path', v.thumbnail_path,
    'transcript', v.transcript, 'chapters', v.chapters, 'duration_seconds', v.duration_seconds,
    'position_seconds', coalesce((select position_seconds from public.caosce_video_progress where user_id = uid and video_id = v.id), 0));
end $$;

create or replace function public.caosce_video_progress(p_video uuid, p_seconds int, p_completed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if not exists (select 1 from public.caosce_videos where id = p_video and status = 'published') then raise exception 'video_not_available'; end if;
  insert into public.caosce_video_progress(user_id, video_id, position_seconds, completed)
  values (uid, p_video, greatest(coalesce(p_seconds, 0), 0), coalesce(p_completed, false))
  on conflict (user_id, video_id) do update set position_seconds = excluded.position_seconds,
    completed = public.caosce_video_progress.completed or excluded.completed, updated_at = now();
end $$;

create or replace function public.caosce_progress_mark(p_procedure uuid, p_stage text, p_step uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if p_stage not in ('understand','equipment','prepare','video','steps','station','results') then raise exception 'invalid_stage'; end if;
  if not exists (select 1 from public.caosce_procedures where id = p_procedure and status = 'published') then raise exception 'procedure_not_available'; end if;
  insert into public.caosce_progress(user_id, procedure_id, stages_done, steps_understood)
  values (uid, p_procedure, array[p_stage], case when p_step is null then '{}' else array[p_step] end)
  on conflict (user_id, procedure_id) do update set
    stages_done = (select array_agg(distinct s) from unnest(public.caosce_progress.stages_done || array[p_stage]) s),
    steps_understood = case when p_step is null then public.caosce_progress.steps_understood
        else (select array_agg(distinct s) from unnest(public.caosce_progress.steps_understood || array[p_step]) s) end,
    updated_at = now();
end $$;

-- ---------- virtual laboratory exercises -----------------------------
create or replace function public.caosce_exercise_get(p_exercise uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); x public.caosce_exercises; p public.caosce_procedures;
begin
  select * into x from public.caosce_exercises where id = p_exercise;
  if not found or (x.status <> 'published' and not public.lab_staff()) then raise exception 'exercise_not_available'; end if;
  select * into p from public.caosce_procedures where id = x.procedure_id;
  if not (public.lab_access(uid, 'caosce') or p.is_free_preview) then raise exception 'payment_required'; end if;
  return jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'scenario', x.scenario, 'multi', x.multi, 'procedure', p.name,
    'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text') order by random()) from jsonb_array_elements(x.options) o));
end $$;

create or replace function public.caosce_exercise_check(p_exercise uuid, p_selected text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); x public.caosce_exercises; corr text[]; hits int; wrongs int; sc numeric;
begin
  select * into x from public.caosce_exercises where id = p_exercise;
  if not found or (x.status <> 'published' and not public.lab_staff()) then raise exception 'exercise_not_available'; end if;
  p_selected := coalesce(p_selected, '{}');
  select coalesce(array_agg(o->>'id'), '{}') into corr from jsonb_array_elements(x.options) o where (o->>'correct')::boolean;
  select count(*) into hits from unnest(p_selected) s where s = any(corr);
  wrongs := cardinality(p_selected) - hits;
  sc := case when x.multi then greatest(0, hits - wrongs)::numeric / greatest(cardinality(corr), 1)
             else case when hits = cardinality(corr) and wrongs = 0 and hits > 0 then 1 else 0 end end;
  insert into public.caosce_exercise_attempts(user_id, procedure_id, kind, score, max_score, detail)
  values (uid, x.procedure_id, x.kind, sc, 1, jsonb_build_object('exercise', x.id, 'selected', p_selected));
  return jsonb_build_object('score', sc, 'max', 1, 'explanation', x.explanation,
    'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text', 'correct', (o->>'correct')::boolean,
        'feedback', o->>'feedback', 'selected', (o->>'id') = any(p_selected))) from jsonb_array_elements(x.options) o));
end $$;

create or replace function public.caosce_sequence_check(p_procedure uuid, p_order uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); n int; right_n int := 0; i int; ids uuid[]; sc numeric;
begin
  select array_agg(id order by position) into ids from public.caosce_procedure_steps where procedure_id = p_procedure;
  n := coalesce(cardinality(ids), 0);
  if n = 0 or p_order is null or cardinality(p_order) <> n then raise exception 'invalid_answer'; end if;
  for i in 1..n loop if p_order[i] = ids[i] then right_n := right_n + 1; end if; end loop;
  sc := right_n::numeric / n;
  insert into public.caosce_exercise_attempts(user_id, procedure_id, kind, score, max_score, detail)
  values (uid, p_procedure, 'sequence', sc, 1, jsonb_build_object('correct_positions', right_n, 'steps', n));
  return jsonb_build_object('score', sc, 'max', 1, 'correct_positions', right_n, 'total', n,
    'correct_order', (select jsonb_agg(jsonb_build_object('id', s.id, 'action', s.action, 'rationale', s.rationale,
        'your_position', array_position(p_order, s.id)) order by s.position) from public.caosce_procedure_steps s where s.procedure_id = p_procedure));
end $$;

create or replace function public.caosce_equipment_check(p_procedure uuid, p_selected uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); corr uuid[]; hits int; wrongs int; sc numeric;
begin
  select coalesce(array_agg(equipment_id), '{}') into corr from public.caosce_procedure_equipment where procedure_id = p_procedure;
  p_selected := coalesce(p_selected, '{}');
  select count(*) into hits from unnest(p_selected) s where s = any(corr);
  wrongs := cardinality(p_selected) - hits;
  sc := greatest(0, hits - wrongs)::numeric / greatest(cardinality(corr), 1);
  insert into public.caosce_exercise_attempts(user_id, procedure_id, kind, score, max_score, detail)
  values (uid, p_procedure, 'equipment', sc, 1, jsonb_build_object('hits', hits, 'wrong', wrongs));
  return jsonb_build_object('score', sc, 'max', 1, 'hits', hits, 'wrong', wrongs,
    'missed', (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'purpose', e.purpose)) from public.caosce_equipment e where e.id = any(corr) and not (e.id = any(p_selected))),
    'wrong_items', (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name)) from public.caosce_equipment e where e.id = any(p_selected) and not (e.id = any(corr))));
end $$;

create or replace function public.caosce_rationale_check(p_step uuid, p_answer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); s public.caosce_procedure_steps; cov numeric; credit numeric;
begin
  select * into s from public.caosce_procedure_steps where id = p_step;
  if not found or s.rationale is null then raise exception 'step_not_found'; end if;
  p_answer := left(btrim(coalesce(p_answer, '')), 1000);
  if length(p_answer) < 3 then raise exception 'answer_empty'; end if;
  cov := public._lab_cover(public._lab_tokens(p_answer), s.rationale);
  credit := case when cov >= 0.5 then 1 when cov >= 0.25 then 0.5 else 0 end;
  insert into public.caosce_exercise_attempts(user_id, procedure_id, kind, score, max_score, detail)
  values (uid, s.procedure_id, 'rationale', credit, 1, jsonb_build_object('step', s.id));
  return jsonb_build_object('score', credit, 'max', 1, 'rationale', s.rationale, 'explanation', s.explanation,
    'verdict', case credit when 1 then 'Good explanation.' when 0.5 then 'Partly right. Compare with the reference reasoning.' else 'Review the reference reasoning below.' end);
end $$;

-- ---------- question stations ----------------------------------------
create or replace function public._caosce_grade(q public.caosce_questions, ans jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sel text[]; corr text[]; hits int; wrongs int; sc numeric; mx numeric := 1; kp jsonb; credit numeric; toks text[];
begin
  if q.kind <> 'short' then
    select coalesce(array_agg(x), '{}') into sel from jsonb_array_elements_text(coalesce(ans->'selected', '[]'::jsonb)) x;
    select coalesce(array_agg(o->>'id'), '{}') into corr from jsonb_array_elements(q.options) o where (o->>'correct')::boolean;
    select count(*) into hits from unnest(sel) s where s = any(corr);
    wrongs := cardinality(sel) - hits;
    sc := case when q.kind = 'multi' then greatest(0, hits - wrongs)::numeric / greatest(cardinality(corr), 1)
               else case when hits = cardinality(corr) and wrongs = 0 and hits > 0 then 1 else 0 end end;
    return jsonb_build_object('score', sc, 'max', 1, 'correct_ids', to_jsonb(corr), 'selected', to_jsonb(sel));
  end if;
  toks := public._lab_tokens(coalesce(ans->>'text', ''));
  sc := 0; mx := 0;
  for kp in select * from jsonb_array_elements(q.key_points) loop
    mx := mx + coalesce((kp->>'marks')::numeric, 1);
    credit := case when cardinality(toks) < 2 then 0 else public._lab_point_credit(toks, kp->>'point',
                coalesce((select array_agg(a) from jsonb_array_elements_text(kp->'accepted') a), '{}')) end;
    sc := sc + credit * coalesce((kp->>'marks')::numeric, 1);
  end loop;
  if mx = 0 then mx := 1; end if;
  return jsonb_build_object('score', sc, 'max', mx, 'text', ans->>'text');
end $$;

create or replace function public.caosce_questions_get(p_procedure uuid default null, p_count int default 10)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'caosce');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'stem', x.stem, 'image_path', x.image_path,
      'procedure', x.pname, 'options', x.opts)) from (
    select q.id, q.kind, q.stem, q.image_path, p.name pname,
           (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text') order by random()) from jsonb_array_elements(q.options) o) opts
      from public.caosce_questions q left join public.caosce_procedures p on p.id = q.procedure_id
     where q.status = 'published' and public._lab_prog_ok(q.programme) and (acc or coalesce(p.is_free_preview, false))
       and (p_procedure is null or q.procedure_id = p_procedure)
     order by random() limit least(greatest(coalesce(p_count, 10), 1), 30)) x), '[]');
end $$;

create or replace function public.caosce_question_check(p_question uuid, p_answer jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); q public.caosce_questions; g jsonb;
begin
  select * into q from public.caosce_questions where id = p_question and (status = 'published' or public.lab_staff());
  if not found then raise exception 'question_not_found'; end if;
  g := public._caosce_grade(q, coalesce(p_answer, '{}'::jsonb));
  insert into public.caosce_exercise_attempts(user_id, procedure_id, kind, score, max_score, detail)
  values (uid, q.procedure_id, 'question', (g->>'score')::numeric, (g->>'max')::numeric, jsonb_build_object('question', q.id));
  return g || jsonb_build_object('explanation', q.explanation, 'rationale', q.rationale, 'model_answer', q.model_answer,
    'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text', 'correct', (o->>'correct')::boolean, 'why', o->>'why')) from jsonb_array_elements(q.options) o));
end $$;

-- ---------- exam engine ----------------------------------------------
create or replace function public._caosce_score_procedure(sa public.caosce_station_attempts)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare narr text[] := public._lab_tokens(coalesce(sa.answers->>'procedure', '')); c record; v record; cov numeric; credit numeric; frac numeric;
        got numeric := 0; mx numeric := 0; items jsonb := '[]'; vv jsonb := '[]'; crit jsonb := '[]'; ans text;
begin
  for c in select * from public.station_checklist_items where station_id = sa.station_id order by position loop
    cov := public._lab_cover(narr, c.step);
    credit := case when cov >= 0.6 then 1 when cov >= 0.35 then 0.5 else 0 end;
    got := got + credit * c.points; mx := mx + c.points;
    items := items || jsonb_build_object('id', c.id, 'step', c.step, 'points', c.points, 'awarded', credit * c.points,
        'critical', c.is_critical, 'status', case credit when 1 then 'done' when 0.5 then 'partial' else 'missed' end);
    if c.is_critical and credit = 0 then crit := crit || jsonb_build_object('id', c.id, 'step', c.step); end if;
  end loop;
  for v in select * from public.station_viva_questions where station_id = sa.station_id order by position loop
    ans := coalesce(sa.answers->'viva'->>(v.id::text), '');
    cov := public._lab_cover(public._lab_tokens(ans), coalesce(v.expected_points, v.prompt));
    frac := case when length(btrim(ans)) < 3 then 0 else least(1, cov / 0.6) end;
    frac := round(frac * 2) / 2;
    got := got + frac * v.marks; mx := mx + v.marks;
    vv := vv || jsonb_build_object('id', v.id, 'prompt', v.prompt, 'marks', v.marks, 'awarded', frac * v.marks,
        'expected_points', v.expected_points, 'answer', ans);
  end loop;
  return jsonb_build_object('score', got, 'max', mx, 'detail', jsonb_build_object('checklist', items, 'viva', vv, 'critical_missed', crit,
      'note', 'Marked on what the student wrote. It does not show that the procedure was performed correctly in practice.'));
end $$;

create or replace function public._caosce_score_questions(sa public.caosce_station_attempts)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare qid uuid; q public.caosce_questions; g jsonb; got numeric := 0; mx numeric := 0; items jsonb := '[]';
begin
  foreach qid in array sa.question_ids loop
    select * into q from public.caosce_questions where id = qid;
    g := public._caosce_grade(q, coalesce(sa.answers->'answers'->(qid::text), '{}'::jsonb));
    got := got + (g->>'score')::numeric; mx := mx + (g->>'max')::numeric;
    items := items || (jsonb_build_object('id', q.id, 'stem', q.stem, 'explanation', q.explanation, 'rationale', q.rationale,
        'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text', 'correct', (o->>'correct')::boolean, 'why', o->>'why')) from jsonb_array_elements(q.options) o),
        'model_answer', q.model_answer) || g);
  end loop;
  return jsonb_build_object('score', got, 'max', mx, 'detail', jsonb_build_object('questions', items));
end $$;

create or replace function public._caosce_finalize_station(p_sa uuid, p_zero boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare sa public.caosce_station_attempts; r jsonb;
begin
  select * into sa from public.caosce_station_attempts where id = p_sa for update;
  if sa.submitted_at is not null then return; end if;
  r := case sa.kind when 'procedure' then public._caosce_score_procedure(sa) else public._caosce_score_questions(sa) end;
  if p_zero then r := jsonb_build_object('score', 0, 'max', r->'max', 'detail', (r->'detail') || jsonb_build_object('timed_out', true)); end if;
  update public.caosce_station_attempts set submitted_at = now(), score = (r->>'score')::numeric, max_score = (r->>'max')::numeric, detail = r->'detail'
   where id = sa.id;
end $$;

create or replace function public._caosce_advance(p_attempt uuid, p_early boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare ea public.caosce_exam_attempts; sa public.caosce_station_attempts; ex public.caosce_exams; dl timestamptz; first_pass boolean := true; tot numeric; mx numeric;
begin
  loop
    select * into ea from public.caosce_exam_attempts where id = p_attempt for update;
    exit when ea.status <> 'in_progress';
    select * into ex from public.caosce_exams where id = ea.exam_id;
    select * into sa from public.caosce_station_attempts where attempt_id = ea.id and position = ea.current_position;
    if sa.started_at is null then update public.caosce_station_attempts set started_at = now() where id = sa.id; sa.started_at := now(); end if;
    dl := sa.started_at + make_interval(secs => sa.seconds);
    if p_early and first_pass then
      perform public._caosce_finalize_station(sa.id);
    elsif now() > dl + interval '3 seconds' then
      perform public._caosce_finalize_station(sa.id, ex.on_timeout = 'lock');
    else
      exit;
    end if;
    if exists (select 1 from public.caosce_station_attempts where attempt_id = ea.id and position = ea.current_position + 1) then
      update public.caosce_exam_attempts set current_position = current_position + 1 where id = ea.id;
      update public.caosce_station_attempts set started_at = case when p_early and first_pass then now() else dl end
       where attempt_id = ea.id and position = ea.current_position + 1;
    else
      select coalesce(sum(score), 0), coalesce(sum(max_score), 0) into tot, mx from public.caosce_station_attempts where attempt_id = ea.id;
      update public.caosce_exam_attempts set status = 'submitted', submitted_at = now(), score = tot, max_score = mx,
        passed = (mx > 0 and 100 * tot / mx >= ex.pass_percent) where id = ea.id;
      exit;
    end if;
    first_pass := false;
  end loop;
end $$;

create or replace function public.caosce_exams_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'caosce');
begin
  return jsonb_build_object('has_access', acc, 'exams', coalesce((
    select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'instructions', e.instructions,
      'pass_percent', e.pass_percent, 'stations', (select jsonb_agg(jsonb_build_object('position', s.position, 'kind', s.kind, 'seconds', s.seconds,
          'title', coalesce(cs.title, 'Question station (' || s.question_count || ' questions)')) order by s.position)
          from public.caosce_exam_stations s left join public.clinical_stations cs on cs.id = s.station_id where s.exam_id = e.id),
      'open_attempt', (select a.id from public.caosce_exam_attempts a where a.exam_id = e.id and a.user_id = uid and a.status = 'in_progress' order by a.started_at desc limit 1),
      'best_percent', (select round(max(100 * a.score / nullif(a.max_score, 0))) from public.caosce_exam_attempts a where a.exam_id = e.id and a.user_id = uid and a.status = 'submitted'))
      order by e.title)
    from public.caosce_exams e where e.status = 'published' and public._lab_prog_ok(e.programme)), '[]'));
end $$;

create or replace function public.caosce_exam_start(p_exam uuid, p_mode text default 'mock', p_position int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); ex public.caosce_exams; v_id uuid; r record; pos int := 0; used uuid[] := '{}'; qids uuid[]; n int; v_exam uuid := p_exam;
begin
  if not public.lab_access(uid, 'caosce') then raise exception 'payment_required'; end if;
  if p_mode not in ('mock','timed_station','revision') then raise exception 'invalid_mode'; end if;
  if p_mode = 'revision' then
    select exam_id into v_exam from (
      select ea.exam_id from public.caosce_station_attempts sa join public.caosce_exam_attempts ea on ea.id = sa.attempt_id
       where sa.user_id = uid and sa.submitted_at is not null and sa.max_score > 0 and sa.score / sa.max_score < 0.6
       order by sa.submitted_at desc limit 1) w;
    if v_exam is null then raise exception 'no_weak_topics'; end if;
  end if;
  select * into ex from public.caosce_exams where id = v_exam and (status = 'published' or public.lab_staff());
  if not found or not public._lab_prog_ok(ex.programme) then raise exception 'exam_not_available'; end if;
  insert into public.caosce_exam_attempts(user_id, exam_id, mode) values (uid, ex.id, p_mode) returning id into v_id;

  if p_mode = 'revision' then
    for r in select kind, station_id, seconds, greatest(cardinality(question_ids), 5) qn from (
        select distinct on (coalesce(sa.station_id::text, sa.kind || sa.position::text)) sa.kind, sa.station_id, sa.seconds, sa.question_ids, sa.score / sa.max_score ratio
          from public.caosce_station_attempts sa
         where sa.user_id = uid and sa.submitted_at is not null and sa.max_score > 0 and sa.score / sa.max_score < 0.6
         order by coalesce(sa.station_id::text, sa.kind || sa.position::text), sa.submitted_at desc) w order by ratio limit 4 loop
      pos := pos + 1;
      if r.kind = 'questions' then
        select coalesce(array_agg(id), '{}') into qids from (select id from public.caosce_questions where status = 'published' and public._lab_prog_ok(programme)
          and id <> all(used) order by random() limit r.qn) z;
        used := used || qids;
      else qids := '{}'; end if;
      insert into public.caosce_station_attempts(attempt_id, user_id, position, kind, station_id, question_ids, seconds)
      values (v_id, uid, pos, r.kind, r.station_id, qids, r.seconds);
    end loop;
  else
    for r in select * from public.caosce_exam_stations where exam_id = ex.id and (p_mode = 'mock' or position = p_position) order by position loop
      pos := pos + 1;
      if r.kind = 'questions' then
        select coalesce(array_agg(id), '{}') into qids from (select id from public.caosce_questions where status = 'published' and public._lab_prog_ok(programme)
          and id <> all(used) order by random() limit r.question_count) z;
        used := used || qids;
      else qids := '{}'; end if;
      insert into public.caosce_station_attempts(attempt_id, user_id, position, kind, station_id, question_ids, seconds)
      values (v_id, uid, pos, r.kind, r.station_id, qids, r.seconds);
    end loop;
  end if;
  select count(*) into n from public.caosce_station_attempts where attempt_id = v_id;
  if n = 0 then raise exception 'no_content'; end if;
  if exists (select 1 from public.caosce_station_attempts where attempt_id = v_id and kind = 'questions' and cardinality(question_ids) = 0)
     and not exists (select 1 from public.caosce_station_attempts where attempt_id = v_id and kind = 'procedure') then raise exception 'no_content'; end if;
  update public.caosce_station_attempts set started_at = now() where attempt_id = v_id and position = 1;
  return v_id;
end $$;

create or replace function public.caosce_exam_get(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); ea public.caosce_exam_attempts; ex public.caosce_exams; sa public.caosce_station_attempts; st public.clinical_stations; cur jsonb;
begin
  select * into ea from public.caosce_exam_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  perform public._caosce_advance(ea.id);
  select * into ea from public.caosce_exam_attempts where id = p_attempt;
  select * into ex from public.caosce_exams where id = ea.exam_id;
  if ea.status = 'in_progress' then
    select * into sa from public.caosce_station_attempts where attempt_id = ea.id and position = ea.current_position;
    if sa.kind = 'procedure' then
      select * into st from public.clinical_stations where id = sa.station_id;
      cur := jsonb_build_object('kind', 'procedure', 'title', st.title, 'scenario', st.scenario, 'candidate_instructions', st.candidate_instructions,
        'viva', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'prompt', v.prompt, 'marks', v.marks) order by v.position)
                  from public.station_viva_questions v where v.station_id = st.id), '[]'),
        'checklist_count', (select count(*) from public.station_checklist_items where station_id = st.id));
    else
      cur := jsonb_build_object('kind', 'questions', 'title', 'Question station',
        'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'stem', q.stem, 'image_path', q.image_path,
            'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')) from jsonb_array_elements(q.options) o))
            order by array_position(sa.question_ids, q.id)) from public.caosce_questions q where q.id = any(sa.question_ids)), '[]'));
    end if;
    cur := cur || jsonb_build_object('position', sa.position, 'seconds', sa.seconds, 'answers', sa.answers,
      'seconds_left', greatest(0, floor(extract(epoch from (sa.started_at + make_interval(secs => sa.seconds)) - now()))));
  end if;
  return jsonb_build_object('id', ea.id, 'status', ea.status, 'mode', ea.mode, 'exam', jsonb_build_object('title', ex.title, 'instructions', ex.instructions, 'pass_percent', ex.pass_percent),
    'total_stations', (select count(*) from public.caosce_station_attempts where attempt_id = ea.id), 'position', ea.current_position, 'current', cur, 'server_now', now());
end $$;

create or replace function public.caosce_exam_save(p_attempt uuid, p_position int, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); ea public.caosce_exam_attempts; sa public.caosce_station_attempts;
begin
  select * into ea from public.caosce_exam_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 40000 then raise exception 'invalid_answers'; end if;
  perform public._caosce_advance(ea.id);
  select * into ea from public.caosce_exam_attempts where id = p_attempt;
  if ea.status <> 'in_progress' or ea.current_position <> p_position then raise exception 'time_up'; end if;
  update public.caosce_station_attempts set answers = answers || p_answers where attempt_id = ea.id and position = p_position
    and submitted_at is null returning * into sa;
  return jsonb_build_object('saved', true, 'seconds_left', greatest(0, floor(extract(epoch from (sa.started_at + make_interval(secs => sa.seconds)) - now()))));
end $$;

create or replace function public.caosce_exam_next(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if not exists (select 1 from public.caosce_exam_attempts where id = p_attempt and user_id = uid and status = 'in_progress') then raise exception 'attempt_not_found'; end if;
  perform public._caosce_advance(p_attempt, true);
  return public.caosce_exam_get(p_attempt);
end $$;

create or replace function public.caosce_exam_report(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); ea public.caosce_exam_attempts; ex public.caosce_exams;
begin
  select * into ea from public.caosce_exam_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  perform public._caosce_advance(ea.id);
  select * into ea from public.caosce_exam_attempts where id = p_attempt;
  if ea.status <> 'submitted' then raise exception 'attempt_not_finished'; end if;
  select * into ex from public.caosce_exams where id = ea.exam_id;
  return jsonb_build_object('id', ea.id, 'exam', ex.title, 'mode', ea.mode, 'score', ea.score, 'max', ea.max_score, 'passed', ea.passed,
    'pass_percent', ex.pass_percent, 'percent', round(100 * ea.score / nullif(ea.max_score, 0)),
    'stations', (select jsonb_agg(jsonb_build_object('position', sa.position, 'kind', sa.kind, 'title', coalesce(cs.title, 'Question station'),
        'score', sa.score, 'max', sa.max_score, 'detail', sa.detail,
        'revise', (select jsonb_build_object('id', p.id, 'name', p.name) from public.caosce_procedures p where p.station_id = sa.station_id limit 1))
        order by sa.position) from public.caosce_station_attempts sa left join public.clinical_stations cs on cs.id = sa.station_id where sa.attempt_id = ea.id),
    'disclaimer', 'Practice result only. This is not an official NMCN CAOSCE result and does not predict your examination result.');
end $$;

-- ---------- student dashboards ---------------------------------------
create or replace function public.caosce_home()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'caosce');
begin
  return jsonb_build_object('programme', public.my_programme_code(), 'has_access', acc,
    'counts', jsonb_build_object(
      'procedures', (select count(*) from public.caosce_procedures p where p.status = 'published' and public._lab_prog_ok(p.programme)),
      'equipment', (select count(*) from public.caosce_equipment where status = 'published'),
      'videos', (select count(*) from public.caosce_videos v where v.status = 'published' and public._lab_prog_ok(v.programme)),
      'exams', (select count(*) from public.caosce_exams e where e.status = 'published' and public._lab_prog_ok(e.programme))),
    'studied', (select count(*) from public.caosce_progress g join public.caosce_procedures p on p.id = g.procedure_id where g.user_id = uid and cardinality(g.stages_done) > 0 and p.status = 'published'),
    'recommended', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'locked', not (acc or p.is_free_preview))) from (
        select p.* from public.caosce_procedures p left join public.caosce_progress g on g.procedure_id = p.id and g.user_id = uid
         where p.status = 'published' and public._lab_prog_ok(p.programme) and coalesce(cardinality(g.stages_done), 0) < 4
         order by coalesce(cardinality(g.stages_done), 0) desc, p.position limit 4) p), '[]'),
    'daily', (select jsonb_build_object('id', p.id, 'name', p.name, 'locked', not (acc or p.is_free_preview)) from public.caosce_procedures p
         where p.status = 'published' and public._lab_prog_ok(p.programme) order by md5(p.id::text || current_date::text) limit 1),
    'recent', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', a.id, 'exam', e.title, 'status', a.status, 'percent', round(100 * a.score / nullif(a.max_score, 0)), 'passed', a.passed, 'started_at', a.started_at) x
         from public.caosce_exam_attempts a join public.caosce_exams e on e.id = a.exam_id where a.user_id = uid order by a.started_at desc limit 5) s), '[]'));
end $$;

create or replace function public.caosce_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  return jsonb_build_object(
    'procedures_total', (select count(*) from public.caosce_procedures p where p.status = 'published' and public._lab_prog_ok(p.programme)),
    'procedures_done', (select count(*) from public.caosce_progress g where g.user_id = uid and 'results' = any(g.stages_done)),
    'procedures_started', (select count(*) from public.caosce_progress g where g.user_id = uid and cardinality(g.stages_done) > 0),
    'exercise_avg', (select round(100 * sum(score) / nullif(sum(max_score), 0)) from public.caosce_exercise_attempts where user_id = uid),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'attempts', n, 'percent', pct)) from (
        select kind, count(*) n, round(100 * sum(score) / nullif(sum(max_score), 0)) pct from public.caosce_exercise_attempts where user_id = uid group by kind) t), '[]'),
    'weak_procedures', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'percent', pct) order by pct) from (
        select p.id, p.name, round(100 * sum(a.score) / nullif(sum(a.max_score), 0)) pct from public.caosce_exercise_attempts a
          join public.caosce_procedures p on p.id = a.procedure_id where a.user_id = uid group by p.id, p.name
         having sum(a.max_score) > 0 order by 3 limit 5) t where pct < 70), '[]'),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'percent', pct, 'attempts', n) order by pct) from (
        select coalesce(cs.title, 'Question stations') title, count(*) n, round(100 * sum(sa.score) / nullif(sum(sa.max_score), 0)) pct
          from public.caosce_station_attempts sa left join public.clinical_stations cs on cs.id = sa.station_id
         where sa.user_id = uid and sa.submitted_at is not null group by 1) t), '[]'),
    'critical_mistakes', coalesce((select jsonb_agg(step) from (select c->>'step' step from public.caosce_station_attempts sa, jsonb_array_elements(sa.detail->'critical_missed') c
        where sa.user_id = uid and sa.detail ? 'critical_missed' group by 1 order by count(*) desc limit 6) t), '[]'),
    'videos', jsonb_build_object('started', (select count(*) from public.caosce_video_progress where user_id = uid),
                                 'completed', (select count(*) from public.caosce_video_progress where user_id = uid and completed)),
    'exams', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'exam', e.title, 'percent', round(100 * a.score / nullif(a.max_score, 0)), 'passed', a.passed, 'at', a.submitted_at) order by a.submitted_at desc)
        from public.caosce_exam_attempts a join public.caosce_exams e on e.id = a.exam_id where a.user_id = uid and a.status = 'submitted'), '[]'));
end $$;

-- ---------- admin tools ----------------------------------------------
create or replace function public.lab_publish(p_table text, p_id uuid, p_reviewer text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_rev text := nullif(btrim(coalesce(p_reviewer, '')), ''); p public.caosce_procedures;
begin
  if p_table not in ('viva_categories','viva_cases','caosce_categories','caosce_procedures','caosce_equipment','caosce_videos','caosce_exercises','caosce_questions','caosce_exams') then
    raise exception 'invalid_table'; end if;
  perform public.require_permission('content.review');
  if p_table = 'caosce_procedures' then
    select * into p from public.caosce_procedures where id = p_id;
    if not found then raise exception 'not_found'; end if;
    if not exists (select 1 from public.caosce_procedure_steps where procedure_id = p_id) then raise exception 'procedure_needs_steps'; end if;
    if coalesce(cardinality(p.source_references), 0) = 0 then raise exception 'procedure_needs_source'; end if;
    if coalesce(v_rev, p.reviewer) is null then raise exception 'reviewer_required'; end if;
    insert into public.caosce_procedure_versions(procedure_id, version, snapshot, saved_by)
    values (p_id, p.version, jsonb_build_object('procedure', to_jsonb(p),
        'steps', (select coalesce(jsonb_agg(to_jsonb(s) order by s.position), '[]') from public.caosce_procedure_steps s where s.procedure_id = p_id)), auth.uid());
    update public.caosce_procedures set status = 'published', reviewer = coalesce(v_rev, reviewer), reviewed_at = current_date,
      version = case when status = 'published' then version + 1 else version end where id = p_id;
  elsif p_table = 'viva_cases' then
    if not exists (select 1 from public.viva_questions where case_id = p_id) then raise exception 'case_needs_questions'; end if;
    update public.viva_cases set status = 'published', reviewed_by = coalesce(v_rev, reviewed_by), reviewed_at = current_date where id = p_id;
  elsif p_table = 'caosce_videos' then
    update public.caosce_videos set status = 'published', reviewer = coalesce(v_rev, reviewer), reviewed_at = current_date where id = p_id;
  else
    execute format('update public.%I set status = ''published'' where id = $1', p_table) using p_id;
  end if;
  perform public.audit('PUBLISH', p_table, p_id::text, null, jsonb_build_object('reviewer', v_rev));
end $$;

create or replace function public.lab_unpublish(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_table not in ('viva_categories','viva_cases','caosce_categories','caosce_procedures','caosce_equipment','caosce_videos','caosce_exercises','caosce_questions','caosce_exams') then
    raise exception 'invalid_table'; end if;
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  execute format('update public.%I set status = ''unpublished'' where id = $1', p_table) using p_id;
  perform public.audit('UNPUBLISH', p_table, p_id::text, null, null);
end $$;

-- Tutor sign-off: publish every draft in an area in one step.
create or replace function public.lab_publish_all(p_area text, p_reviewer text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_rev text := nullif(btrim(coalesce(p_reviewer, '')), ''); n int := 0; r record;
begin
  perform public.require_permission('content.review');
  if v_rev is null then raise exception 'reviewer_required'; end if;
  if p_area = 'viva' then
    update public.viva_categories set status = 'published' where status in ('draft','in_review','unpublished');
    for r in select id from public.viva_cases where status in ('draft','in_review','unpublished') and exists (select 1 from public.viva_questions q where q.case_id = viva_cases.id) loop
      perform public.lab_publish('viva_cases', r.id, v_rev); n := n + 1; end loop;
  elsif p_area = 'caosce' then
    update public.caosce_categories set status = 'published' where status in ('draft','in_review','unpublished');
    update public.caosce_equipment set status = 'published' where status in ('draft','in_review','unpublished');
    for r in select id from public.caosce_procedures where status in ('draft','in_review','unpublished')
             and exists (select 1 from public.caosce_procedure_steps s where s.procedure_id = caosce_procedures.id) and coalesce(cardinality(source_references), 0) > 0 loop
      perform public.lab_publish('caosce_procedures', r.id, v_rev); n := n + 1; end loop;
    update public.caosce_exercises set status = 'published' where status in ('draft','in_review','unpublished');
    update public.caosce_questions set status = 'published' where status in ('draft','in_review','unpublished');
    update public.caosce_exams set status = 'published' where status in ('draft','in_review','unpublished');
    update public.caosce_videos set status = 'published', reviewer = v_rev, reviewed_at = current_date where status in ('draft','in_review','unpublished');
  else raise exception 'invalid_area'; end if;
  return jsonb_build_object('published_items', n);
end $$;

create or replace function public.lab_duplicate_procedure(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.caosce_procedures; v_id uuid; n int;
begin
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  select * into p from public.caosce_procedures where id = p_id;
  if not found then raise exception 'not_found'; end if;
  select count(*) + 1 into n from public.caosce_procedures where code like p.code || '-COPY%';
  insert into public.caosce_procedures(code, category_id, programme, name, description, definition, purpose, anatomy, objectives, indications, contraindications,
      expected_outcomes, safety, patient_prep, source_references, station_id, position)
  values (p.code || '-COPY' || n, p.category_id, p.programme, p.name || ' (copy)', p.description, p.definition, p.purpose, p.anatomy, p.objectives, p.indications,
      p.contraindications, p.expected_outcomes, p.safety, p.patient_prep, p.source_references, null, p.position + 1) returning id into v_id;
  insert into public.caosce_procedure_steps(procedure_id, position, action, explanation, rationale, safety, common_mistake, expected_outcome, is_critical)
    select v_id, position, action, explanation, rationale, safety, common_mistake, expected_outcome, is_critical from public.caosce_procedure_steps where procedure_id = p_id;
  insert into public.caosce_procedure_equipment(procedure_id, equipment_id, position)
    select v_id, equipment_id, position from public.caosce_procedure_equipment where procedure_id = p_id;
  return v_id;
end $$;

create or replace function public.lab_reorder(p_table text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare i int;
begin
  if p_table not in ('caosce_procedure_steps','viva_questions','viva_key_points','viva_cases','caosce_procedures','caosce_categories','viva_categories','caosce_exercises') then raise exception 'invalid_table'; end if;
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  for i in 1..coalesce(cardinality(p_ids), 0) loop
    execute format('update public.%I set position = $1 where id = $2', p_table) using i, p_ids[i];
  end loop;
end $$;

create or replace function public.lab_analytics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.lab_staff() or public.has_permission('reports.manage')) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'viva', jsonb_build_object(
      'active_students', (select count(distinct user_id) from public.viva_attempts),
      'sessions', (select count(*) from public.viva_attempts),
      'avg_percent', (select round(avg(100 * score / nullif(max_score, 0))) from public.viva_attempts where status <> 'in_progress'),
      'hardest_questions', coalesce((select jsonb_agg(jsonb_build_object('prompt', prompt, 'percent', pct, 'answers', n)) from (
          select q.prompt, count(*) n, round(100 * sum(r.score) / nullif(sum(r.max_score), 0)) pct from public.viva_responses r join public.viva_questions q on q.id = r.question_id
           group by q.prompt having count(*) >= 3 order by 3 limit 5) t), '[]'),
      'common_misses', coalesce((select jsonb_agg(jsonb_build_object('point', point, 'times', n)) from (
          select k.point, count(*) n from public.viva_responses r join public.viva_key_points k on k.id = any(r.missed_points) group by k.point order by 2 desc limit 8) t), '[]'),
      'popular_categories', coalesce((select jsonb_agg(jsonb_build_object('category', name, 'answers', n)) from (
          select k.name, count(*) n from public.viva_responses r join public.viva_questions q on q.id = r.question_id join public.viva_cases c on c.id = q.case_id
            join public.viva_categories k on k.id = c.category_id group by k.name order by 2 desc limit 6) t), '[]'),
      'ai_calls', (select count(*) from public.lab_ai_logs where area = 'viva')),
    'caosce', jsonb_build_object(
      'studied', coalesce((select jsonb_agg(jsonb_build_object('procedure', name, 'students', n) order by n desc) from (
          select p.name, count(*) n from public.caosce_progress g join public.caosce_procedures p on p.id = g.procedure_id where cardinality(g.stages_done) > 0 group by p.name order by 2 desc limit 5) t), '[]'),
      'least_studied', coalesce((select jsonb_agg(jsonb_build_object('procedure', name, 'students', n) order by n) from (
          select p.name, count(g.user_id) n from public.caosce_procedures p left join public.caosce_progress g on g.procedure_id = p.id and cardinality(g.stages_done) > 0
           where p.status = 'published' group by p.name order by 2 limit 5) t), '[]'),
      'exercise_avg', (select round(100 * sum(score) / nullif(sum(max_score), 0)) from public.caosce_exercise_attempts),
      'failed_stations', coalesce((select jsonb_agg(jsonb_build_object('station', title, 'percent', pct, 'attempts', n) order by pct) from (
          select coalesce(cs.title, 'Question stations') title, count(*) n, round(100 * sum(sa.score) / nullif(sum(sa.max_score), 0)) pct
            from public.caosce_station_attempts sa left join public.clinical_stations cs on cs.id = sa.station_id where sa.submitted_at is not null group by 1 order by 3 limit 5) t), '[]'),
      'missed_items', coalesce((select jsonb_agg(jsonb_build_object('step', step, 'times', n)) from (
          select i->>'step' step, count(*) n from public.caosce_station_attempts sa, jsonb_array_elements(sa.detail->'checklist') i
           where sa.detail ? 'checklist' and i->>'status' = 'missed' group by 1 order by 2 desc limit 8) t), '[]'),
      'watched_videos', coalesce((select jsonb_agg(jsonb_build_object('video', title, 'viewers', n)) from (
          select v.title, count(*) n from public.caosce_video_progress vp join public.caosce_videos v on v.id = vp.video_id group by v.title order by 2 desc limit 5) t), '[]'),
      'exam_attempts', (select count(*) from public.caosce_exam_attempts),
      'exam_avg', (select round(avg(100 * score / nullif(max_score, 0))) from public.caosce_exam_attempts where status = 'submitted'),
      'by_programme', coalesce((select jsonb_agg(jsonb_build_object('programme', prog, 'attempts', n, 'avg', pct)) from (
          select coalesce(pr.code, 'n/a') prog, count(*) n, round(avg(100 * a.score / nullif(a.max_score, 0))) pct
            from public.caosce_exam_attempts a join public.profiles p on p.id = a.user_id left join public.programmes pr on pr.id = p.programme_id
           where a.status = 'submitted' group by 1) t), '[]')));
end $$;

-- ---------- grants ---------------------------------------------------
revoke all on function public._caosce_grade(public.caosce_questions, jsonb), public._caosce_score_procedure(public.caosce_station_attempts),
  public._caosce_score_questions(public.caosce_station_attempts), public._caosce_finalize_station(uuid, boolean), public._caosce_advance(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.caosce_library(uuid, text), public.caosce_categories_list(), public.caosce_procedure(uuid), public.caosce_video_get(uuid),
  public.caosce_video_progress(uuid, int, boolean), public.caosce_progress_mark(uuid, text, uuid), public.caosce_exercise_get(uuid),
  public.caosce_exercise_check(uuid, text[]), public.caosce_sequence_check(uuid, uuid[]), public.caosce_equipment_check(uuid, uuid[]),
  public.caosce_rationale_check(uuid, text), public.caosce_questions_get(uuid, int), public.caosce_question_check(uuid, jsonb),
  public.caosce_exams_list(), public.caosce_exam_start(uuid, text, int), public.caosce_exam_get(uuid), public.caosce_exam_save(uuid, int, jsonb),
  public.caosce_exam_next(uuid), public.caosce_exam_report(uuid), public.caosce_home(), public.caosce_dashboard(),
  public.lab_publish(text, uuid, text), public.lab_unpublish(text, uuid), public.lab_publish_all(text, text),
  public.lab_duplicate_procedure(uuid), public.lab_reorder(text, uuid[]), public.lab_analytics() to authenticated;
