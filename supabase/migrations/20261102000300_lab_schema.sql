-- =====================================================================
-- 0300 VIVA + CAOSCE LAB — SCHEMA, ACCESS HELPERS, RLS
-- Additive only. Students never read content tables directly (extraction
-- protection): every student read goes through SECURITY DEFINER RPCs that
-- check publication status, programme and access. Staff manage content via RLS.
-- =====================================================================

-- ---------- helpers --------------------------------------------------
create or replace function public.my_programme_code()
returns text language sql stable security definer set search_path = public as $$
  select pr.code from public.profiles p join public.programmes pr on pr.id = p.programme_id where p.id = auth.uid();
$$;

create or replace function public.lab_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_permission('content.manage') or public.has_permission('exams.manage');
$$;

-- Access to the lab: paid Section C or D, or a dedicated viva/caosce entitlement, or staff.
create or replace function public.lab_access(p_uid uuid, p_area text default 'viva')
returns boolean language sql stable security definer set search_path = public as $$
  select public.lab_staff()
      or public.user_has_entitlement(p_uid, 'section_c')
      or public.user_has_entitlement(p_uid, 'section_d')
      or public.user_has_entitlement(p_uid, p_area);
$$;

create or replace function public._lab_prog_ok(p_prog text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.lab_staff() or p_prog = 'ALL' or p_prog = public.my_programme_code();
$$;

-- Publishing clinical content needs the reviewer permission (not just an editor).
create or replace function public.tg_lab_publish_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not public.has_permission('content.review') then
    raise exception 'publish_requires_reviewer';
  end if;
  return new;
end $$;

-- ---------- VIVA -----------------------------------------------------
create table if not exists public.viva_categories (
  id uuid primary key default gen_random_uuid(),
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  name text not null,
  slug text not null unique,
  group_name text,
  position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- A "case" is one oral topic examined as a sequence of questions (question, then follow-ups).
create table if not exists public.viva_cases (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.viva_categories(id) on delete restrict,
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  title text not null,
  intro text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  is_free_preview boolean not null default false,
  source_reference text, reviewed_by text, reviewed_at date,
  position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists viva_cases_cat on public.viva_cases(category_id, status);

create table if not exists public.viva_questions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.viva_cases(id) on delete cascade,
  position int not null default 0,
  prompt text not null,
  model_answer text not null,
  explanation text,
  further_reading text,
  marks numeric not null default 5 check (marks > 0),
  unsafe_phrases text[] not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists viva_questions_case on public.viva_questions(case_id, position);

-- The marking guide. "accepted" holds equivalent wordings (synonyms, local and
-- British/American variants) so answers are marked on meaning, not exact words.
create table if not exists public.viva_key_points (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.viva_questions(id) on delete cascade,
  position int not null default 0,
  point text not null,
  accepted text[] not null default '{}',
  marks numeric not null default 1 check (marks > 0),
  is_critical boolean not null default false
);
create index if not exists viva_key_points_q on public.viva_key_points(question_id, position);

create table if not exists public.viva_examiner_settings (
  style text primary key check (style in ('friendly','professional','strict')),
  label text not null, intro text not null, praise text not null, probe text not null,
  active boolean not null default true
);

create table if not exists public.viva_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('learning','practice','mock','weakness')),
  examiner_style text not null default 'professional' references public.viva_examiner_settings(style),
  programme text not null,
  category_id uuid references public.viva_categories(id),
  question_ids uuid[] not null default '{}',
  status text not null default 'in_progress' check (status in ('in_progress','submitted','expired')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  score numeric, max_score numeric
);
create index if not exists viva_attempts_user on public.viva_attempts(user_id, started_at desc);

create table if not exists public.viva_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.viva_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.viva_questions(id) on delete restrict,
  answer text not null,
  source text not null default 'text' check (source in ('text','voice')),
  score numeric not null default 0, max_score numeric not null default 0,
  hit_points uuid[] not null default '{}', partial_points uuid[] not null default '{}', missed_points uuid[] not null default '{}',
  self_points uuid[] not null default '{}',
  flags jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists viva_responses_user on public.viva_responses(user_id, created_at desc);

-- ---------- CAOSCE ---------------------------------------------------
create table if not exists public.caosce_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique, position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.caosce_procedures (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  category_id uuid references public.caosce_categories(id) on delete set null,
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  name text not null,
  description text, definition text, purpose text, anatomy text,
  objectives text[] not null default '{}', indications text[] not null default '{}',
  contraindications text[] not null default '{}', expected_outcomes text[] not null default '{}',
  safety text[] not null default '{}',
  patient_prep jsonb not null default '[]',      -- [{action, why}]
  source_references text[] not null default '{}',
  reviewer text, reviewed_at date,
  version int not null default 1,
  station_id uuid references public.clinical_stations(id) on delete set null,
  is_free_preview boolean not null default false,
  position int not null default 0,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists caosce_procedures_cat on public.caosce_procedures(category_id, status);

create table if not exists public.caosce_procedure_steps (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  position int not null default 0,
  action text not null, explanation text, rationale text, safety text, common_mistake text, expected_outcome text,
  is_critical boolean not null default false
);
create index if not exists caosce_steps_proc on public.caosce_procedure_steps(procedure_id, position);

create table if not exists public.caosce_equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  purpose text, correct_use text, precautions text,
  image_path text,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.caosce_procedure_equipment (
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  equipment_id uuid not null references public.caosce_equipment(id) on delete cascade,
  position int not null default 0,
  primary key (procedure_id, equipment_id)
);

create table if not exists public.caosce_videos (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  kind text not null check (kind in ('complete','step_by_step','mistakes','equipment','other')),
  title text not null, description text,
  storage_path text, external_url text,
  thumbnail_path text, captions_path text,
  duration_seconds int, transcript text,
  chapters jsonb not null default '[]',          -- [{t, title}]
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  reviewer text, reviewed_at date,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (storage_path is not null or external_url is not null)
);
create index if not exists caosce_videos_proc on public.caosce_videos(procedure_id, status);

create table if not exists public.caosce_exercises (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  kind text not null check (kind in ('mistake','decision')),
  title text not null, scenario text not null,
  options jsonb not null default '[]',            -- [{id, text, correct, feedback}]
  multi boolean not null default false,
  explanation text,
  position int not null default 0,
  status public.publication_status not null default 'draft'
);
create index if not exists caosce_exercises_proc on public.caosce_exercises(procedure_id);

create table if not exists public.caosce_questions (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid references public.caosce_procedures(id) on delete set null,
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  kind text not null default 'mcq' check (kind in ('mcq','multi','short','scenario','equipment')),
  stem text not null,
  options jsonb not null default '[]',            -- [{id, text, correct, why}]
  model_answer text,
  key_points jsonb not null default '[]',         -- short answers: [{point, accepted[], marks}]
  explanation text, rationale text,
  difficulty text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  image_path text, source_reference text,
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists caosce_questions_proc on public.caosce_questions(procedure_id, status);

create table if not exists public.caosce_exams (
  id uuid primary key default gen_random_uuid(),
  title text not null, description text, instructions text,
  programme text not null default 'ALL' check (programme in ('ALL','RN','RM')),
  pass_percent numeric not null default 50,
  on_timeout text not null default 'submit' check (on_timeout in ('submit','lock')),
  status public.publication_status not null default 'draft',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.caosce_exam_stations (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.caosce_exams(id) on delete cascade,
  position int not null,
  kind text not null check (kind in ('procedure','questions')),
  station_id uuid references public.clinical_stations(id) on delete restrict,
  question_count int not null default 20,
  seconds int not null default 600 check (seconds between 60 and 3600),
  unique (exam_id, position)
);

create table if not exists public.caosce_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid not null references public.caosce_exams(id) on delete restrict,
  mode text not null default 'mock' check (mode in ('mock','timed_station','revision')),
  status text not null default 'in_progress' check (status in ('in_progress','submitted')),
  current_position int not null default 1,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score numeric, max_score numeric, passed boolean
);
create index if not exists caosce_exam_attempts_user on public.caosce_exam_attempts(user_id, started_at desc);

create table if not exists public.caosce_station_attempts (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.caosce_exam_attempts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position int not null,
  kind text not null,
  station_id uuid references public.clinical_stations(id),
  question_ids uuid[] not null default '{}',
  started_at timestamptz,                         -- authoritative server time
  seconds int not null,
  submitted_at timestamptz,
  answers jsonb not null default '{}',
  score numeric, max_score numeric,
  detail jsonb not null default '{}',
  unique (attempt_id, position)
);

create table if not exists public.caosce_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  stages_done text[] not null default '{}',
  steps_understood uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, procedure_id)
);

create table if not exists public.caosce_video_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.caosce_videos(id) on delete cascade,
  position_seconds int not null default 0, completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create table if not exists public.caosce_exercise_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  procedure_id uuid references public.caosce_procedures(id) on delete cascade,
  kind text not null check (kind in ('sequence','equipment','mistake','decision','rationale','question')),
  score numeric not null default 0, max_score numeric not null default 0,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists caosce_ex_att_user on public.caosce_exercise_attempts(user_id, created_at desc);

-- Version history of published procedures (snapshot written at publish time).
create table if not exists public.caosce_procedure_versions (
  id uuid primary key default gen_random_uuid(),
  procedure_id uuid not null references public.caosce_procedures(id) on delete cascade,
  version int not null, snapshot jsonb not null,
  saved_by uuid, created_at timestamptz not null default now()
);

-- AI usage log for the lab (provider-agnostic; empty until an AI provider is configured).
create table if not exists public.lab_ai_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  area text not null, action text not null,
  input_tokens int, output_tokens int, flagged boolean not null default false, note text,
  created_at timestamptz not null default now()
);

-- ---------- triggers -------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array['viva_categories','viva_cases','viva_questions','caosce_procedures','caosce_equipment','caosce_videos','caosce_questions','caosce_exams'] loop
    execute format('create or replace trigger %I_updated before update on public.%I for each row execute function public.tg_set_updated_at()', t, t);
  end loop;
  foreach t in array array['viva_categories','viva_cases','caosce_categories','caosce_procedures','caosce_equipment','caosce_videos','caosce_exercises','caosce_questions','caosce_exams'] loop
    execute format('create or replace trigger %I_publish_guard before insert or update on public.%I for each row execute function public.tg_lab_publish_guard()', t, t);
  end loop;
  foreach t in array array['viva_categories','viva_cases','viva_questions','viva_key_points','caosce_categories','caosce_procedures','caosce_procedure_steps','caosce_equipment','caosce_videos','caosce_exercises','caosce_questions','caosce_exams','caosce_exam_stations'] loop
    execute format('create or replace trigger %I_audit after insert or update or delete on public.%I for each row execute function public.tg_audit_row()', t, t);
  end loop;
end $do$;

-- ---------- RLS ------------------------------------------------------
do $do$
declare t text;
begin
  foreach t in array array[
    'viva_categories','viva_cases','viva_questions','viva_key_points','viva_examiner_settings',
    'caosce_categories','caosce_procedures','caosce_procedure_steps','caosce_equipment','caosce_procedure_equipment',
    'caosce_videos','caosce_exercises','caosce_questions','caosce_exams','caosce_exam_stations','caosce_procedure_versions'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t || '_staff') then
      execute format('create policy %I on public.%I for all to authenticated using (public.lab_staff()) with check (public.lab_staff())', t || '_staff', t);
    end if;
  end loop;
  -- student-private tables: owner (or staff) can read; all writes go through RPCs
  foreach t in array array['viva_attempts','viva_responses','caosce_exam_attempts','caosce_station_attempts','caosce_progress','caosce_video_progress','caosce_exercise_attempts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname='public' and tablename=t and policyname=t || '_own') then
      execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid() or public.has_permission(''reports.manage''))', t || '_own', t);
    end if;
  end loop;
end $do$;
alter table public.lab_ai_logs enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='lab_ai_logs' and policyname='lab_ai_logs_staff') then
    create policy lab_ai_logs_staff on public.lab_ai_logs for select to authenticated using (public.has_permission('ai.manage'));
  end if;
end $do$;

-- ---------- storage: lab-media --------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('lab-media', 'lab-media', false, 52428800,
   array['video/mp4','video/webm','image/png','image/jpeg','image/webp','text/vtt'])
on conflict (id) do nothing;

do $do$ begin
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='lab media read') then
    create policy "lab media read" on storage.objects for select to authenticated
      using (bucket_id = 'lab-media' and public.is_active_user() and (
        public.lab_staff()
        or exists (select 1 from public.caosce_videos v where v.status='published' and name in (v.storage_path, v.thumbnail_path, v.captions_path))
        or exists (select 1 from public.caosce_equipment e where e.status='published' and e.image_path = name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='lab media managed by editors') then
    create policy "lab media managed by editors" on storage.objects for all to authenticated
      using (bucket_id = 'lab-media' and public.lab_staff())
      with check (bucket_id = 'lab-media' and public.lab_staff());
  end if;
end $do$;
