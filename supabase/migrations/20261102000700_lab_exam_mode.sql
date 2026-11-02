-- Real-exam behaviour for Paper 4 (Sections C and D): paid only, random content, no choice.
-- Practice (menu) labs stay open on free-preview items; free items are the small practice set.

do $$
declare d text;
begin
  d := pg_get_functiondef('public.viva_start(text,uuid,int,text,uuid)'::regprocedure);
  if position('lab_exam_mode' in d) = 0 then
    d := replace(d, E'  if p_mode not in (''learning'',''practice'',''mock'',''weakness'') then raise exception ''invalid_mode''; end if;',
      E'  if p_mode not in (''learning'',''practice'',''mock'',''weakness'') then raise exception ''invalid_mode''; end if;\n  -- lab_exam_mode: the exam is random and paid only\n  if p_mode = ''mock'' then if not acc then raise exception ''payment_required''; end if; p_category := null; p_case := null; end if;');
    execute d;
  end if;
end $$;

create or replace function public.caosce_exam_start_random()
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); ex public.caosce_exams; v_id uuid; r record; pos int := 0; qids uuid[];
begin
  if not public.lab_access(uid, 'caosce') or not (public.user_has_entitlement(uid, 'section_c') or public.user_has_entitlement(uid, 'section_d') or public.lab_staff()) then
    raise exception 'payment_required'; end if;
  select * into ex from public.caosce_exams where status = 'published' and public._lab_prog_ok(programme) order by random() limit 1;
  if not found then raise exception 'no_content'; end if;
  insert into public.caosce_exam_attempts(user_id, exam_id, mode) values (uid, ex.id, 'mock') returning id into v_id;
  for r in select s.id station_id from public.clinical_stations s join public.caosce_procedures p on p.station_id = s.id
            where s.status = 'published' and p.status = 'published' and public._lab_prog_ok(p.programme) order by random() limit 2 loop
    pos := pos + 1;
    insert into public.caosce_station_attempts(attempt_id, user_id, position, kind, station_id, question_ids, seconds)
    values (v_id, uid, pos, 'procedure', r.station_id, '{}', 600);
  end loop;
  select coalesce(array_agg(id), '{}') into qids from (select id from public.caosce_questions where status = 'published' and public._lab_prog_ok(programme) order by random() limit 5) z;
  if cardinality(qids) > 0 then
    pos := pos + 1;
    insert into public.caosce_station_attempts(attempt_id, user_id, position, kind, station_id, question_ids, seconds)
    values (v_id, uid, pos, 'questions', null, qids, 300);
  end if;
  if pos = 0 then raise exception 'no_content'; end if;
  update public.caosce_station_attempts set started_at = now() where attempt_id = v_id and position = 1;
  return v_id;
end $$;
revoke execute on function public.caosce_exam_start_random() from public, anon;
grant execute on function public.caosce_exam_start_random() to authenticated;

-- small practice set open to everyone
update public.viva_cases set is_free_preview = true where title in ('Hand hygiene, standard precautions and needle-stick injury', 'Informed consent and confidentiality', 'Immediate care of the newborn');
update public.caosce_procedures set is_free_preview = true where code in ('RN-HH', 'RN-BP', 'RM-LM', 'RM-NR');
