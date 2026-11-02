-- 3D CAOSCE: interactive virtual clinical skills lab (paid: Sections C and D, staff)

create table if not exists public.sim3d_equipment (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null, category text, description text, purpose text, how_to_use text,
  precautions text, infection_notes text, mistakes text,
  position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.sim3d_procedures (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  category text, difficulty text default 'Intermediate', minutes int default 10,
  description text, definition text,
  objectives text[] not null default '{}', indications text[] not null default '{}',
  contraindications text[] not null default '{}', safety text[] not null default '{}',
  outcomes text[] not null default '{}', refs text[] not null default '{}',
  scene jsonb not null default '{}',
  steps jsonb not null default '[]',
  unsafe jsonb not null default '[]',
  challenges jsonb not null default '[]',
  exam_seconds int not null default 600 check (exam_seconds > 0),
  pass_percent int not null default 50 check (pass_percent between 1 and 100),
  version int not null default 1,
  reviewer text, reviewed_at date,
  position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.sim3d_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid not null references public.sim3d_procedures(id) on delete cascade,
  version int not null default 1,
  mode text not null check (mode in ('guided','practice','exam')),
  status text not null default 'in_progress' check (status in ('in_progress','finished','expired')),
  started_at timestamptz not null default now(), deadline_at timestamptz, finished_at timestamptz,
  score numeric, max_score numeric, percent numeric, passed boolean,
  state jsonb not null default '{"done":{},"wrong":{},"unsafe":[],"hints":0}',
  result jsonb
);
create index if not exists sim3d_attempts_user on public.sim3d_attempts(user_id, started_at desc);

create table if not exists public.sim3d_events (
  id bigserial primary key,
  attempt_id uuid not null references public.sim3d_attempts(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null, value text, step_key text,
  outcome text not null, severity text
);
create index if not exists sim3d_events_attempt on public.sim3d_events(attempt_id, id);

create table if not exists public.sim3d_challenge_log (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid not null references public.sim3d_procedures(id) on delete cascade,
  challenge_id text not null, correct boolean not null,
  created_at timestamptz not null default now()
);

do $do$
declare t text;
begin
  foreach t in array array['sim3d_equipment','sim3d_procedures'] loop
    execute format('create or replace trigger %I_updated before update on public.%I for each row execute function public.tg_set_updated_at()', t, t);
    execute format('create or replace trigger %I_publish_guard before insert or update on public.%I for each row execute function public.tg_lab_publish_guard()', t, t);
    execute format('create or replace trigger %I_audit after insert or update or delete on public.%I for each row execute function public.tg_audit_row()', t, t);
  end loop;
  foreach t in array array['sim3d_equipment','sim3d_procedures','sim3d_attempts','sim3d_events','sim3d_challenge_log'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t||'_staff') then
      execute format('create policy %I on public.%I for all to authenticated using (public.lab_staff()) with check (public.lab_staff())', t||'_staff', t);
    end if;
  end loop;
  create policy sim3d_attempts_own on public.sim3d_attempts for select to authenticated using (user_id = auth.uid());
end $do$;

-- ---------- helpers ----------------------------------------------------
create or replace function public._s3_view(p public.sim3d_procedures, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; out jsonb := '[]'; o jsonb;
begin
  for s in select * from jsonb_array_elements(p.steps) loop
    o := jsonb_build_object('key', s->>'key', 'title', s->>'title', 'kind', s->>'kind', 'marks', (s->>'marks')::numeric,
      'instruction', s->>'instruction', 'critical', coalesce((s->>'critical')::boolean, false));
    if s->>'kind' = 'choice' then
      o := o || jsonb_build_object('prompt', s->>'prompt', 'options', (select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'text', x->>'text')), '[]') from jsonb_array_elements(s->'options') x));
    end if;
    if p_mode = 'guided' then o := o || jsonb_build_object('rationale', s->>'rationale'); end if;
    out := out || jsonb_build_array(o);
  end loop;
  return out;
end $$;

create or replace function public._s3_scene(p public.sim3d_procedures)
returns jsonb language sql stable security definer set search_path = public as $$
  select p.scene || jsonb_build_object(
    'equipment', (select coalesce(jsonb_agg(jsonb_build_object('key', e.key, 'name', e.name, 'category', e.category,
        'description', e.description, 'purpose', e.purpose, 'how_to_use', e.how_to_use, 'precautions', e.precautions,
        'infection_notes', e.infection_notes, 'mistakes', e.mistakes) order by ord), '[]')
      from jsonb_array_elements_text(p.scene->'equipment') with ordinality k(key, ord)
      join public.sim3d_equipment e on e.key = k.key and e.status = 'published'));
$$;

create or replace function public._s3_next(p public.sim3d_procedures, st jsonb, p_mode text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s jsonb; tgt jsonb;
begin
  for s in select * from jsonb_array_elements(p.steps) loop
    if not (st->'done' ? (s->>'key')) then
      tgt := case when s ? 'hint' then s->'hint' else null end;
      return jsonb_build_object('key', s->>'key', 'title', s->>'title', 'instruction', s->>'instruction', 'kind', s->>'kind',
        'target', coalesce(tgt, jsonb_build_object('kind', s->>'kind', 'value', coalesce(s->'values'->>0, ''))));
    end if;
  end loop;
  return null;
end $$;

-- ---------- student RPCs -----------------------------------------------
create or replace function public.sim3d_equipment_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if not public.lab_access(uid, 'sim3d') then raise exception 'payment_required'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'status' - 'created_at' - 'updated_at' order by e.position, e.name), '[]')
          from public.sim3d_equipment e where e.status = 'published');
end $$;

create or replace function public.sim3d_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); acc boolean := public.lab_access(uid, 'sim3d');
begin
  return jsonb_build_object('access', acc, 'items', (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'programme', p.programme,
      'category', p.category, 'difficulty', p.difficulty, 'minutes', p.minutes, 'description', p.description, 'steps', jsonb_array_length(p.steps),
      'best', (select max(a.percent) from public.sim3d_attempts a where a.user_id = uid and a.procedure_id = p.id and a.status = 'finished'),
      'attempts', (select count(*) from public.sim3d_attempts a where a.user_id = uid and a.procedure_id = p.id and a.status = 'finished'))
      order by p.position, p.title), '[]')
    from public.sim3d_procedures p where p.status = 'published' and public._lab_prog_ok(p.programme)));
end $$;

create or replace function public.sim3d_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); p public.sim3d_procedures;
begin
  if not public.lab_access(uid, 'sim3d') then raise exception 'payment_required'; end if;
  select * into p from public.sim3d_procedures where id = p_id and (status = 'published' or public.lab_staff());
  if not found or not public._lab_prog_ok(p.programme) then raise exception 'not_found'; end if;
  return jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'category', p.category, 'difficulty', p.difficulty, 'minutes', p.minutes,
    'description', p.description, 'definition', p.definition, 'objectives', p.objectives, 'indications', p.indications,
    'contraindications', p.contraindications, 'safety', p.safety, 'outcomes', p.outcomes, 'refs', p.refs,
    'exam_seconds', p.exam_seconds, 'pass_percent', p.pass_percent, 'scene', public._s3_scene(p), 'steps', public._s3_view(p, 'practice'));
end $$;

create or replace function public.sim3d_start(p_id uuid, p_mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); p public.sim3d_procedures; v uuid;
begin
  if p_mode not in ('guided','practice','exam') then raise exception 'invalid_mode'; end if;
  if not public.lab_access(uid, 'sim3d') then raise exception 'payment_required'; end if;
  select * into p from public.sim3d_procedures where id = p_id and (status = 'published' or public.lab_staff());
  if not found or not public._lab_prog_ok(p.programme) then raise exception 'not_found'; end if;
  update public.sim3d_attempts set status = 'expired', finished_at = now() where user_id = uid and procedure_id = p.id and status = 'in_progress';
  insert into public.sim3d_attempts(user_id, procedure_id, version, mode, deadline_at)
  values (uid, p.id, p.version, p_mode, case when p_mode = 'exam' then now() + make_interval(secs => p.exam_seconds) end) returning id into v;
  return v;
end $$;

create or replace function public.sim3d_session(p_attempt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); a public.sim3d_attempts; p public.sim3d_procedures;
begin
  select * into a from public.sim3d_attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'not_found'; end if;
  select * into p from public.sim3d_procedures where id = a.procedure_id;
  return jsonb_build_object('attempt', jsonb_build_object('id', a.id, 'mode', a.mode, 'status', a.status, 'deadline_at', a.deadline_at, 'started_at', a.started_at,
      'done', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(a.state->'done') k), 'server_now', now(), 'result', a.result),
    'procedure', jsonb_build_object('id', p.id, 'code', p.code, 'title', p.title, 'category', p.category, 'description', p.description, 'definition', p.definition,
      'objectives', p.objectives, 'safety', p.safety, 'indications', p.indications, 'contraindications', p.contraindications, 'refs', p.refs,
      'exam_seconds', p.exam_seconds, 'pass_percent', p.pass_percent),
    'scene', public._s3_scene(p), 'steps', public._s3_view(p, a.mode),
    'next', case when a.mode = 'guided' and a.status = 'in_progress' then public._s3_next(p, a.state, a.mode) end);
end $$;

create or replace function public.sim3d_act(p_attempt uuid, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user(); a public.sim3d_attempts; p public.sim3d_procedures;
  k text := p_action->>'kind'; v text := p_action->>'value'; sk text := p_action->>'step';
  s jsonb; hit jsonb := null; seq_ok boolean; r text; sel text[]; items text[]; extra text[];
  good int; bad int; frac numeric; out text := 'extra'; msg text; u jsonb; st jsonb; pen numeric; crit boolean;
  wrong_before boolean;
begin
  select * into a from public.sim3d_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if a.status <> 'in_progress' then raise exception 'already_finished'; end if;
  if a.deadline_at is not null and now() > a.deadline_at + interval '3 seconds' then raise exception 'time_up'; end if;
  select * into p from public.sim3d_procedures where id = a.procedure_id;
  st := a.state;

  if k = 'hint' then
    if a.mode <> 'practice' then raise exception 'invalid_mode'; end if;
    st := jsonb_set(st, '{hints}', to_jsonb(coalesce((st->>'hints')::int, 0) + 1));
    update public.sim3d_attempts set state = st where id = a.id;
    insert into public.sim3d_events(attempt_id, kind, value, outcome) values (a.id, 'hint', null, 'hint');
    return jsonb_build_object('ok', true, 'outcome', 'hint', 'next', public._s3_next(p, st, a.mode));
  end if;

  -- unsafe actions
  for u in select * from jsonb_array_elements(p.unsafe) loop
    if u->>'kind' = k and u->>'value' = v then
      pen := coalesce((u->>'penalty')::numeric, 0); crit := coalesce((u->>'critical')::boolean, false);
      st := jsonb_set(st, '{unsafe}', coalesce(st->'unsafe', '[]') || jsonb_build_array(jsonb_build_object('value', v, 'message', u->>'message', 'critical', crit, 'penalty', pen)));
      update public.sim3d_attempts set state = st where id = a.id;
      insert into public.sim3d_events(attempt_id, kind, value, outcome, severity) values (a.id, k, v, 'unsafe', case when crit then 'critical' else 'minor' end);
      if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
      return jsonb_build_object('ok', true, 'outcome', 'unsafe', 'message', u->>'message', 'critical', crit,
        'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
    end if;
  end loop;

  if k = 'equipment' then
    select array_agg(x) into sel from jsonb_array_elements_text(coalesce(p_action->'items', '[]')) x;
    sel := coalesce(sel, '{}');
    for s in select * from jsonb_array_elements(p.steps) loop
      if s->>'kind' = 'equipment' and not (st->'done' ? (s->>'key')) then hit := s; exit; end if;
    end loop;
    if hit is null then return jsonb_build_object('ok', true, 'outcome', 'extra'); end if;
    select array_agg(x) into items from jsonb_array_elements_text(hit->'items') x;
    select array_agg(x) into extra from jsonb_array_elements_text(coalesce(hit->'extra_ok', '[]')) x;
    items := coalesce(items, '{}'); extra := coalesce(extra, '{}');
    select count(*) into good from unnest(sel) x where x = any(items);
    select count(*) into bad from unnest(sel) x where not (x = any(items)) and not (x = any(extra));
    frac := greatest(0, (good - bad)::numeric / greatest(cardinality(items), 1));
    if bad > 0 and a.mode <> 'exam' then null; end if;
    st := jsonb_set(st, array['done', hit->>'key'], to_jsonb(frac));
    update public.sim3d_attempts set state = st where id = a.id;
    insert into public.sim3d_events(attempt_id, kind, value, step_key, outcome) values (a.id, 'equipment', array_to_string(sel, ','), hit->>'key', case when frac >= 1 then 'correct' when frac > 0 then 'partial' else 'incorrect' end);
    if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
    return jsonb_build_object('ok', true, 'step', hit->>'key', 'outcome', case when frac >= 1 then 'correct' when frac > 0 then 'partial' else 'incorrect' end,
      'missing', (select coalesce(jsonb_agg(x), '[]') from unnest(items) x where not (x = any(sel))),
      'wrong', (select coalesce(jsonb_agg(x), '[]') from unnest(sel) x where not (x = any(items)) and not (x = any(extra))),
      'message', case when frac >= 1 then 'Correct tray.' else 'Tray is incomplete or contains unneeded items.' end,
      'rationale', hit->>'rationale', 'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
  end if;

  if k = 'choice' then
    for s in select * from jsonb_array_elements(p.steps) loop
      if s->>'kind' = 'choice' and s->>'key' = sk then hit := s; exit; end if;
    end loop;
    if hit is null or st->'done' ? sk then return jsonb_build_object('ok', true, 'outcome', 'extra'); end if;
    seq_ok := not exists (select 1 from jsonb_array_elements_text(coalesce(hit->'requires', '[]')) q where not (st->'done' ? q));
    if exists (select 1 from jsonb_array_elements_text(hit->'values') x where x = v) then
      frac := case when seq_ok then 1 else 0.5 end; out := case when seq_ok then 'correct' else 'sequence' end;
    else
      frac := 0; out := 'incorrect';
    end if;
    if out = 'incorrect' and a.mode <> 'exam' then
      insert into public.sim3d_events(attempt_id, kind, value, step_key, outcome) values (a.id, k, v, sk, 'incorrect');
      return jsonb_build_object('ok', true, 'outcome', 'incorrect', 'message', 'That is not the best answer. Think again.', 'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
    end if;
    st := jsonb_set(st, array['done', sk], to_jsonb(frac));
    update public.sim3d_attempts set state = st where id = a.id;
    insert into public.sim3d_events(attempt_id, kind, value, step_key, outcome) values (a.id, k, v, sk, out);
    if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
    return jsonb_build_object('ok', true, 'step', sk, 'outcome', out, 'rationale', hit->>'rationale', 'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
  end if;

  if k not in ('object','zone','position') then raise exception 'invalid_action'; end if;

  -- find the matching undone step; prefer one whose prerequisites are done
  for s in select * from jsonb_array_elements(p.steps) loop
    if s->>'kind' = k and not (st->'done' ? (s->>'key')) and exists (select 1 from jsonb_array_elements_text(s->'values') x where x = v) then
      seq_ok := not exists (select 1 from jsonb_array_elements_text(coalesce(s->'requires', '[]')) q where not (st->'done' ? q));
      if seq_ok then hit := s; exit; end if;
      if hit is null then hit := s; end if;
    end if;
  end loop;

  if hit is null then
    -- wrong choice for a pending zone/position step is an error; anything else is extra
    for s in select * from jsonb_array_elements(p.steps) loop
      if s->>'kind' = k and k in ('zone','position') and not (st->'done' ? (s->>'key'))
         and not exists (select 1 from jsonb_array_elements_text(coalesce(s->'requires', '[]')) q where not (st->'done' ? q)) then
        wrong_before := true;
        if a.mode = 'exam' then
          st := jsonb_set(st, array['done', s->>'key'], to_jsonb(0));
        else
          st := jsonb_set(st, array['wrong', s->>'key'], 'true'::jsonb);
        end if;
        update public.sim3d_attempts set state = st where id = a.id;
        insert into public.sim3d_events(attempt_id, kind, value, step_key, outcome) values (a.id, k, v, s->>'key', 'incorrect');
        if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
        return jsonb_build_object('ok', true, 'outcome', 'incorrect', 'message', 'That is not the correct choice for this step.', 'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
      end if;
    end loop;
    insert into public.sim3d_events(attempt_id, kind, value, outcome) values (a.id, k, v, 'extra');
    if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
    return jsonb_build_object('ok', true, 'outcome', 'extra', 'message', 'That action is not needed now.', 'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
  end if;

  seq_ok := not exists (select 1 from jsonb_array_elements_text(coalesce(hit->'requires', '[]')) q where not (st->'done' ? q));
  wrong_before := coalesce((st->'wrong' ? (hit->>'key')), false);
  frac := case when not seq_ok then 0.5 when wrong_before then 0.5 else 1 end;
  out := case when not seq_ok then 'sequence' else 'correct' end;
  st := jsonb_set(st, array['done', hit->>'key'], to_jsonb(frac));
  update public.sim3d_attempts set state = st where id = a.id;
  insert into public.sim3d_events(attempt_id, kind, value, step_key, outcome) values (a.id, k, v, hit->>'key', out);
  if a.mode = 'exam' then return jsonb_build_object('ok', true, 'outcome', 'ack'); end if;
  return jsonb_build_object('ok', true, 'step', hit->>'key', 'outcome', out, 'rationale', hit->>'rationale',
    'message', case when not seq_ok then 'Done, but out of sequence. Half marks for this step.' end,
    'next', case when a.mode = 'guided' then public._s3_next(p, st, a.mode) end);
end $$;

create or replace function public.sim3d_finish(p_attempt uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_active_user(); a public.sim3d_attempts; p public.sim3d_procedures;
  s jsonb; tot numeric := 0; got numeric := 0; pen numeric := 0; rows jsonb := '[]'; crit jsonb := '[]'; f numeric; u jsonb;
  pct numeric; res jsonb;
begin
  select * into a from public.sim3d_attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if a.status <> 'in_progress' then return a.result; end if;
  select * into p from public.sim3d_procedures where id = a.procedure_id;
  for s in select * from jsonb_array_elements(p.steps) loop
    f := coalesce((a.state->'done'->>(s->>'key'))::numeric, 0);
    tot := tot + (s->>'marks')::numeric; got := got + f * (s->>'marks')::numeric;
    rows := rows || jsonb_build_array(jsonb_build_object('key', s->>'key', 'title', s->>'title', 'kind', s->>'kind', 'marks', (s->>'marks')::numeric,
      'got', round(f * (s->>'marks')::numeric, 2), 'critical', coalesce((s->>'critical')::boolean, false),
      'status', case when f >= 1 then 'done' when f > 0 then 'partial' when a.state->'done' ? (s->>'key') then 'wrong' else 'missed' end,
      'instruction', s->>'instruction', 'rationale', s->>'rationale'));
    if coalesce((s->>'critical')::boolean, false) and f < 1 then
      crit := crit || jsonb_build_array(jsonb_build_object('title', s->>'title', 'message', case when f > 0 then 'Critical step done only partly or out of sequence: ' else 'Critical step missed or wrong: ' end || (s->>'title') || '. ' || coalesce(s->>'rationale', '')));
    end if;
  end loop;
  for u in select * from jsonb_array_elements(coalesce(a.state->'unsafe', '[]')) loop
    pen := pen + coalesce((u->>'penalty')::numeric, 0);
    if coalesce((u->>'critical')::boolean, false) then crit := crit || jsonb_build_array(jsonb_build_object('title', 'Unsafe action', 'message', u->>'message')); end if;
  end loop;
  got := greatest(0, got - pen);
  pct := case when tot > 0 then round(got / tot * 100, 1) else 0 end;
  res := jsonb_build_object('score', round(got, 2), 'max', tot, 'percent', pct, 'passed', pct >= p.pass_percent, 'pass_percent', p.pass_percent,
    'penalty', pen, 'steps', rows, 'critical_errors', crit, 'unsafe', coalesce(a.state->'unsafe', '[]'),
    'hints', coalesce((a.state->>'hints')::int, 0), 'mode', a.mode,
    'seconds', extract(epoch from (now() - a.started_at))::int, 'timed_out', (a.deadline_at is not null and now() > a.deadline_at));
  update public.sim3d_attempts set status = 'finished', finished_at = now(), score = got, max_score = tot, percent = pct, passed = pct >= p.pass_percent, result = res where id = a.id;
  return res;
end $$;

create or replace function public.sim3d_challenges(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  if not public.lab_access(uid, 'sim3d') then raise exception 'payment_required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', c->>'id', 'kind', c->>'kind', 'title', c->>'title', 'scenario', c->>'scenario', 'prompt', c->>'prompt',
      'multi', coalesce((c->>'multi')::boolean, false),
      'options', (select jsonb_agg(jsonb_build_object('id', o->>'id', 'text', o->>'text')) from jsonb_array_elements(c->'options') o))), '[]')
    from public.sim3d_procedures p, jsonb_array_elements(p.challenges) c where p.id = p_id and (p.status = 'published' or public.lab_staff()));
end $$;

create or replace function public.sim3d_challenge_check(p_id uuid, p_challenge text, p_selected text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); c jsonb; o jsonb; okc boolean := true; fb jsonb := '[]'; sel boolean;
begin
  if not public.lab_access(uid, 'sim3d') then raise exception 'payment_required'; end if;
  select x into c from public.sim3d_procedures p, jsonb_array_elements(p.challenges) x where p.id = p_id and x->>'id' = p_challenge;
  if c is null then raise exception 'not_found'; end if;
  for o in select * from jsonb_array_elements(c->'options') loop
    sel := (o->>'id') = any(coalesce(p_selected, '{}'));
    if sel <> coalesce((o->>'correct')::boolean, false) then okc := false; end if;
    fb := fb || jsonb_build_array(jsonb_build_object('id', o->>'id', 'correct', coalesce((o->>'correct')::boolean, false), 'selected', sel, 'feedback', o->>'feedback'));
  end loop;
  insert into public.sim3d_challenge_log(user_id, procedure_id, challenge_id, correct) values (uid, p_id, p_challenge, okc);
  return jsonb_build_object('correct', okc, 'options', fb, 'explanation', c->>'explanation');
end $$;

create or replace function public.sim3d_history(p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_active_user();
begin
  return jsonb_build_object(
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', p.title, 'mode', a.mode, 'percent', a.percent, 'passed', a.passed, 'status', a.status, 'at', a.started_at) order by a.started_at desc), '[]')
      from (select * from public.sim3d_attempts where user_id = uid and status <> 'in_progress' order by started_at desc limit greatest(1, least(p_limit, 100))) a join public.sim3d_procedures p on p.id = a.procedure_id),
    'summary', (select jsonb_build_object('count', count(*), 'avg', round(avg(percent), 1), 'best', max(percent), 'passed', count(*) filter (where passed))
      from public.sim3d_attempts where user_id = uid and status = 'finished'),
    'open', (select a.id from public.sim3d_attempts a where a.user_id = uid and a.status = 'in_progress' order by started_at desc limit 1));
end $$;

-- ---------- staff RPCs ---------------------------------------------------
create or replace function public.sim3d_admin_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'procedures', (select coalesce(jsonb_agg(to_jsonb(p) order by p.position, p.title), '[]') from public.sim3d_procedures p),
    'equipment', (select coalesce(jsonb_agg(to_jsonb(e) order by e.position, e.name), '[]') from public.sim3d_equipment e));
end $$;

create or replace function public.sim3d_admin_save(p_kind text, p_row jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  if p_kind = 'procedure' then
    v := nullif(p_row->>'id', '')::uuid;
    if v is null then
      insert into public.sim3d_procedures(code, title, programme, category, difficulty, minutes, description, definition, scene, steps, unsafe, challenges, exam_seconds, pass_percent, position)
      values (p_row->>'code', p_row->>'title', coalesce(p_row->>'programme', 'ALL'), p_row->>'category', coalesce(p_row->>'difficulty', 'Intermediate'), coalesce((p_row->>'minutes')::int, 10),
        p_row->>'description', p_row->>'definition', coalesce(p_row->'scene', '{}'), coalesce(p_row->'steps', '[]'), coalesce(p_row->'unsafe', '[]'), coalesce(p_row->'challenges', '[]'),
        coalesce((p_row->>'exam_seconds')::int, 600), coalesce((p_row->>'pass_percent')::int, 50), coalesce((p_row->>'position')::int, 0)) returning id into v;
    else
      update public.sim3d_procedures set title = coalesce(p_row->>'title', title), programme = coalesce(p_row->>'programme', programme), category = coalesce(p_row->>'category', category),
        difficulty = coalesce(p_row->>'difficulty', difficulty), minutes = coalesce((p_row->>'minutes')::int, minutes), description = coalesce(p_row->>'description', description),
        definition = coalesce(p_row->>'definition', definition), scene = coalesce(p_row->'scene', scene), steps = coalesce(p_row->'steps', steps), unsafe = coalesce(p_row->'unsafe', unsafe),
        challenges = coalesce(p_row->'challenges', challenges), exam_seconds = coalesce((p_row->>'exam_seconds')::int, exam_seconds), pass_percent = coalesce((p_row->>'pass_percent')::int, pass_percent),
        reviewer = coalesce(p_row->>'reviewer', reviewer), version = version + 1 where id = v;
    end if;
  elsif p_kind = 'equipment' then
    v := nullif(p_row->>'id', '')::uuid;
    if v is null then
      insert into public.sim3d_equipment(key, name, category, description, purpose, how_to_use, precautions, infection_notes, mistakes)
      values (p_row->>'key', p_row->>'name', p_row->>'category', p_row->>'description', p_row->>'purpose', p_row->>'how_to_use', p_row->>'precautions', p_row->>'infection_notes', p_row->>'mistakes') returning id into v;
    else
      update public.sim3d_equipment set name = coalesce(p_row->>'name', name), category = coalesce(p_row->>'category', category), description = coalesce(p_row->>'description', description),
        purpose = coalesce(p_row->>'purpose', purpose), how_to_use = coalesce(p_row->>'how_to_use', how_to_use), precautions = coalesce(p_row->>'precautions', precautions),
        infection_notes = coalesce(p_row->>'infection_notes', infection_notes), mistakes = coalesce(p_row->>'mistakes', mistakes) where id = v;
    end if;
  else raise exception 'invalid_kind'; end if;
  return v;
end $$;

create or replace function public.sim3d_admin_status(p_kind text, p_id uuid, p_status public.publication_status)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  if p_kind = 'procedure' then update public.sim3d_procedures set status = p_status, reviewed_at = case when p_status = 'published' then current_date else reviewed_at end where id = p_id;
  elsif p_kind = 'equipment' then update public.sim3d_equipment set status = p_status where id = p_id;
  else raise exception 'invalid_kind'; end if;
end $$;

create or replace function public.sim3d_analytics()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.lab_staff() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'attempts', (select count(*) from public.sim3d_attempts),
    'finished', (select count(*) from public.sim3d_attempts where status = 'finished'),
    'students', (select count(distinct user_id) from public.sim3d_attempts),
    'by_procedure', (select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'attempts', x.n, 'avg', x.av, 'pass_rate', x.pr)), '[]')
      from (select procedure_id, count(*) n, round(avg(percent), 1) av, round(100.0 * count(*) filter (where passed) / nullif(count(*), 0), 1) pr from public.sim3d_attempts where status = 'finished' group by 1) x
      join public.sim3d_procedures p on p.id = x.procedure_id),
    'common_errors', (select coalesce(jsonb_agg(jsonb_build_object('step', z.step_key, 'procedure', z.title, 'n', z.n) order by z.n desc), '[]')
      from (select e.step_key, p.title, count(*) n from public.sim3d_events e join public.sim3d_attempts a on a.id = e.attempt_id join public.sim3d_procedures p on p.id = a.procedure_id
            where e.outcome in ('incorrect','unsafe') group by 1, 2 order by n desc limit 15) z));
end $$;

do $do$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'sim3d\_%' or p.proname like '\_s3\_%') loop
    execute 'revoke execute on function ' || f || ' from public, anon, authenticated';
    if f not like '%._s3_%' then execute 'grant execute on function ' || f || ' to authenticated'; end if;
  end loop;
end $do$;
