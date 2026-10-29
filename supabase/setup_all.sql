-- =====================================================================
-- NMCN Study — complete database setup (all 16 migrations, in order).
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to run more than once. Does NOT include demo content (see seed.sql).
-- Generated from supabase/migrations/*.sql — edit those, not this file.
-- =====================================================================

-- >>>>>>>>>> 20261028000100_foundation.sql
-- =====================================================================
-- 0100 FOUNDATION: extensions, enums, helpers, programmes, profiles, roles
-- Additive only. Safe to apply to an existing Supabase project.
-- =====================================================================

-- pg_trgm powers duplicate-question detection and fuzzy user search.
-- Supabase keeps extensions in the 'extensions' schema; if pg_trgm already
-- exists elsewhere this is a no-op and the search_path below still finds it.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
set search_path = public, extensions;

-- ---------- Enums ----------------------------------------------------
do $$ begin
  create type public.publication_status as enum ('draft','in_review','published','unpublished','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.version_status as enum ('draft','in_review','approved','superseded','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.app_role as enum (
    'super_admin',     -- everything, including roles
    'content_admin',   -- curriculum + notes
    'question_admin',  -- questions, pools, import
    'reviewer',        -- reviews/publishes clinical content
    'exam_admin',      -- Section C/D configuration
    'support',         -- users, tickets, complimentary access
    'finance'          -- payments, refunds, pricing
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.question_bank as enum ('practice','section_c','section_d');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.difficulty_level as enum ('easy','medium','hard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.account_status as enum ('active','suspended');
exception when duplicate_object then null; end $$;

-- ---------- Generic updated_at trigger --------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Programmes (RN / RM) --------------------------------------
create table if not exists public.programmes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Z]{2,6}$'),
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Profiles ---------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  email                 text,
  full_name             text check (char_length(full_name) <= 120),
  phone                 text check (char_length(phone) <= 30),
  programme_id          uuid references public.programmes(id),
  curriculum_version_id uuid,  -- FK added in 0200 once table exists
  institution           text check (char_length(institution) <= 160),
  exam_target_date      date,
  status                public.account_status not null default 'active',
  suspended_reason      text,
  onboarded             boolean not null default false,
  last_active_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists profiles_programme_idx on public.profiles(programme_id);
create index if not exists profiles_email_trgm on public.profiles using gin (email gin_trgm_ops);
create index if not exists profiles_name_trgm on public.profiles using gin (full_name gin_trgm_ops);
drop trigger if exists profiles_updated on public.profiles;
create or replace trigger profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------- Roles & permissions ---------------------------------------
create table if not exists public.user_roles (
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       public.app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.role_permissions (
  role       public.app_role not null,
  permission text not null,
  primary key (role, permission)
);

-- Is the calling user an active (non-suspended) account?
create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

-- Does the calling user hold a permission (via any of their roles)?
-- '*' grants every permission (super_admin).
create or replace function public.has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (
    select 1
    from public.user_roles ur
    join public.role_permissions rp on rp.role = ur.role
    where ur.user_id = auth.uid()
      and (rp.permission = perm or rp.permission = '*')
  );
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and exists (select 1 from public.user_roles where user_id = auth.uid());
$$;

-- Raise a uniform error when a permission is missing (used by admin RPCs).
create or replace function public.require_permission(perm text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.has_permission(perm) then
    raise exception 'permission_denied:%', perm using errcode = '42501';
  end if;
end $$;

create or replace function public.require_active_user()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_active_user() then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  return uid;
end $$;

reset search_path;

-- >>>>>>>>>> 20261028000200_curriculum_content.sql
-- =====================================================================
-- 0200 CURRICULUM & STUDY LIBRARY (Section A)
-- programme -> curriculum version ; course <-> programmes (shared content)
-- course -> module -> topic (-> subtopic) -> notes -> note_versions
-- =====================================================================

create table if not exists public.curriculum_versions (
  id             uuid primary key default gen_random_uuid(),
  programme_id   uuid not null references public.programmes(id),
  label          text not null,                 -- e.g. "RN Curriculum 2024"
  source         text,                          -- where the curriculum was obtained
  effective_from date,
  status         public.publication_status not null default 'draft',
  reviewed_by    uuid references auth.users(id),
  reviewed_at    timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (programme_id, label)
);
create or replace trigger curriculum_versions_updated before update on public.curriculum_versions
  for each row execute function public.tg_set_updated_at();

do $$ begin
  alter table public.profiles
    add constraint profiles_curriculum_fk foreign key (curriculum_version_id)
    references public.curriculum_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (char_length(code) between 2 and 20),
  title       text not null check (char_length(title) between 2 and 200),
  description text,
  level       text,                          -- e.g. "Year 1", "Year 2"
  position    int not null default 0,
  status      public.publication_status not null default 'draft',
  source      text,
  is_demo     boolean not null default false,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists courses_status_pos on public.courses(status, position);
create or replace trigger courses_updated before update on public.courses
  for each row execute function public.tg_set_updated_at();

-- Shared content: one course can belong to RN, RM or both.
create table if not exists public.course_programmes (
  course_id             uuid not null references public.courses(id) on delete cascade,
  programme_id          uuid not null references public.programmes(id),
  curriculum_version_id uuid references public.curriculum_versions(id) on delete set null,
  primary key (course_id, programme_id)
);
create index if not exists course_programmes_prog on public.course_programmes(programme_id);

create table if not exists public.modules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  description text,
  position    int not null default 0,
  status      public.publication_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists modules_course on public.modules(course_id, position);
create or replace trigger modules_updated before update on public.modules
  for each row execute function public.tg_set_updated_at();

create table if not exists public.topics (
  id              uuid primary key default gen_random_uuid(),
  module_id       uuid not null references public.modules(id) on delete cascade,
  parent_topic_id uuid references public.topics(id) on delete cascade,  -- subtopics
  title           text not null check (char_length(title) between 1 and 200),
  summary         text,
  position        int not null default 0,
  status          public.publication_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (parent_topic_id is null or parent_topic_id <> id)
);
create index if not exists topics_module on public.topics(module_id, position);
create index if not exists topics_parent on public.topics(parent_topic_id);
create or replace trigger topics_updated before update on public.topics
  for each row execute function public.tg_set_updated_at();

create table if not exists public.notes (
  id                 uuid primary key default gen_random_uuid(),
  topic_id           uuid not null references public.topics(id) on delete cascade,
  title              text not null check (char_length(title) between 1 and 200),
  kind               text not null default 'note' check (kind in ('note','handout')),
  position           int not null default 0,
  status             public.publication_status not null default 'draft',
  current_version_id uuid,                     -- the published version
  downloadable       boolean not null default false,
  is_demo            boolean not null default false,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists notes_topic on public.notes(topic_id, position);
create or replace trigger notes_updated before update on public.notes
  for each row execute function public.tg_set_updated_at();

create table if not exists public.note_versions (
  id               uuid primary key default gen_random_uuid(),
  note_id          uuid not null references public.notes(id) on delete cascade,
  version          int not null,
  body_md          text not null default '' check (char_length(body_md) <= 400000),
  source_reference text,
  change_summary   text,
  status           public.version_status not null default 'draft',
  author_id        uuid references auth.users(id),
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  review_due_at    date,                         -- next scheduled clinical review
  created_at       timestamptz not null default now(),
  search           tsvector generated always as (to_tsvector('english', coalesce(body_md, ''))) stored,
  unique (note_id, version)
);
create index if not exists note_versions_search on public.note_versions using gin (search);

do $$ begin
  alter table public.notes
    add constraint notes_current_version_fk foreign key (current_version_id)
    references public.note_versions(id) on delete set null deferrable initially deferred;
exception when duplicate_object then null; end $$;

-- Auto-number new versions per note.
create or replace function public.tg_note_version_number()
returns trigger language plpgsql as $$
begin
  if new.version is null or new.version = 0 then
    select coalesce(max(version), 0) + 1 into new.version
    from public.note_versions where note_id = new.note_id;
  end if;
  if new.author_id is null then new.author_id := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists note_versions_number on public.note_versions;
create or replace trigger note_versions_number before insert on public.note_versions
  for each row execute function public.tg_note_version_number();

-- Approved/superseded versions are immutable (edits create a new version).
create or replace function public.tg_note_version_immutable()
returns trigger language plpgsql as $$
begin
  if old.status in ('approved','superseded') and new.body_md is distinct from old.body_md then
    raise exception 'approved_version_immutable: create a new version instead';
  end if;
  return new;
end $$;
drop trigger if exists note_versions_immutable on public.note_versions;
create or replace trigger note_versions_immutable before update on public.note_versions
  for each row execute function public.tg_note_version_immutable();

create table if not exists public.note_attachments (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes(id) on delete cascade,
  storage_path text not null,                -- path inside the 'content' bucket
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  downloadable boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.note_references (
  id       uuid primary key default gen_random_uuid(),
  note_id  uuid not null references public.notes(id) on delete cascade,
  citation text not null,
  url      text check (url is null or url ~* '^https?://'),
  position int not null default 0
);

reset search_path;

-- >>>>>>>>>> 20261028000300_questions.sql
-- =====================================================================
-- 0300 QUESTION BANK (Sections B, C, D)
-- A question lives in exactly ONE bank (practice / section_c / section_d),
-- so Section D can never silently reuse Section C's questions.
-- Answer keys + rationales live in question_options, which students can
-- never SELECT directly (only through scoring RPCs after answering).
-- =====================================================================
set search_path = public, extensions;

create table if not exists public.questions (
  id               uuid primary key default gen_random_uuid(),
  bank             public.question_bank not null default 'practice',
  course_id        uuid references public.courses(id) on delete set null,
  topic_id         uuid references public.topics(id) on delete set null,
  stem             text not null check (char_length(stem) between 5 and 4000),
  clinical_scenario text check (char_length(clinical_scenario) <= 6000),
  image_path       text,                        -- path in 'question-images' bucket
  difficulty       public.difficulty_level not null default 'medium',
  status           public.publication_status not null default 'draft',
  version          int not null default 1,
  source_reference text,
  tags             text[] not null default '{}',
  is_demo          boolean not null default false,
  created_by       uuid references auth.users(id),
  reviewed_by      uuid references auth.users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  stem_normalized  text generated always as (lower(regexp_replace(stem, '\s+', ' ', 'g'))) stored
);
create index if not exists questions_bank_status on public.questions(bank, status);
create index if not exists questions_topic on public.questions(topic_id);
create index if not exists questions_course on public.questions(course_id);
create index if not exists questions_stem_trgm on public.questions using gin (stem_normalized gin_trgm_ops);
create or replace trigger questions_updated before update on public.questions
  for each row execute function public.tg_set_updated_at();

create table if not exists public.question_programmes (
  question_id  uuid not null references public.questions(id) on delete cascade,
  programme_id uuid not null references public.programmes(id),
  primary key (question_id, programme_id)
);
create index if not exists question_programmes_prog on public.question_programmes(programme_id);

create table if not exists public.question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label       text not null check (label in ('A','B','C','D','E')),
  body        text not null check (char_length(body) between 1 and 1500),
  is_correct  boolean not null default false,
  rationale   text check (char_length(rationale) <= 6000),  -- why correct / why wrong
  position    smallint not null default 0,
  unique (question_id, label)
);
create index if not exists question_options_q on public.question_options(question_id);

create table if not exists public.question_versions (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  version     int not null,
  snapshot    jsonb not null,
  change_note text,
  changed_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (question_id, version)
);

-- Pools group questions for exam papers. Pool bank must match question bank.
create table if not exists public.question_pools (
  id          uuid primary key default gen_random_uuid(),
  bank        public.question_bank not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  unique (bank, name)
);

create table if not exists public.question_pool_items (
  pool_id     uuid not null references public.question_pools(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  primary key (pool_id, question_id)
);
create index if not exists question_pool_items_q on public.question_pool_items(question_id);

create or replace function public.tg_pool_item_bank_match()
returns trigger language plpgsql as $$
declare pb public.question_bank; qb public.question_bank;
begin
  select bank into pb from public.question_pools where id = new.pool_id;
  select bank into qb from public.questions where id = new.question_id;
  if pb is distinct from qb then
    raise exception 'pool_bank_mismatch: pool is % but question is %', pb, qb;
  end if;
  return new;
end $$;
drop trigger if exists pool_item_bank_match on public.question_pool_items;
create or replace trigger pool_item_bank_match before insert or update on public.question_pool_items
  for each row execute function public.tg_pool_item_bank_match();

-- Validation used before publishing (also by import).
-- Returns an array of human-readable problems; empty array == valid.
create or replace function public.question_problems(p_question uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  probs text[] := '{}';
  n_opts int; n_correct int; n_missing_rat int; n_prog int;
  q record;
begin
  select * into q from public.questions where id = p_question;
  if not found then return array['question_not_found']; end if;
  select count(*), count(*) filter (where is_correct),
         count(*) filter (where coalesce(trim(rationale), '') = '')
    into n_opts, n_correct, n_missing_rat
    from public.question_options where question_id = p_question;
  select count(*) into n_prog from public.question_programmes where question_id = p_question;
  if n_opts < 2 then probs := probs || text 'needs at least two options'; end if;
  if n_correct <> 1 then probs := probs || format('needs exactly one correct option (has %s)', n_correct); end if;
  if n_missing_rat > 0 then probs := probs || format('%s option(s) missing a rationale', n_missing_rat); end if;
  if n_prog = 0 then probs := probs || text 'assign at least one programme (RN/RM)'; end if;
  if q.topic_id is null and q.course_id is null then probs := probs || text 'assign a course or topic'; end if;
  return probs;
end $$;

-- Hard guard: a question can never be in 'published' state while invalid.
create or replace function public.tg_question_publish_guard()
returns trigger language plpgsql as $$
declare probs text[];
begin
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    probs := public.question_problems(new.id);
    if array_length(probs, 1) > 0 then
      raise exception 'question_invalid: %', array_to_string(probs, '; ');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists question_publish_guard on public.questions;
create constraint trigger question_publish_guard after insert or update of status on public.questions
  deferrable initially deferred
  for each row execute function public.tg_question_publish_guard();

reset search_path;

-- >>>>>>>>>> 20261028000400_practice_exams.sql
-- =====================================================================
-- 0400 PRACTICE SESSIONS (B), EXAM SIMULATORS (C & D), VIVA / CAOSCE
-- All state that affects scores is written only by SECURITY DEFINER RPCs.
-- =====================================================================

-- ---------- Section B: practice ----------------------------------------
create table if not exists public.practice_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mode           text not null default 'random' check (mode in ('random','retry_incorrect','saved')),
  filters        jsonb not null default '{}',
  question_count int not null check (question_count between 1 and 100),
  answered_count int not null default 0,
  correct_count  int not null default 0,
  status         text not null default 'in_progress' check (status in ('in_progress','completed')),
  started_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index if not exists practice_sessions_user on public.practice_sessions(user_id, started_at desc);

create table if not exists public.practice_items (
  session_id         uuid not null references public.practice_sessions(id) on delete cascade,
  position           int not null,
  question_id        uuid not null references public.questions(id) on delete cascade,
  selected_option_id uuid references public.question_options(id) on delete set null,
  is_correct         boolean,
  answered_at        timestamptz,
  primary key (session_id, position),
  unique (session_id, question_id)
);
create index if not exists practice_items_q on public.practice_items(question_id);

-- ---------- Sections C & D: exam configuration -------------------------
create table if not exists public.exam_configs (
  id           uuid primary key default gen_random_uuid(),
  section      text not null check (section in ('C','D')),
  title        text not null,
  description  text,
  instructions text,
  programme_id uuid references public.programmes(id),  -- null = both RN & RM
  status       public.publication_status not null default 'draft',
  max_attempts int check (max_attempts is null or max_attempts > 0),  -- per paper
  position     int not null default 0,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create or replace trigger exam_configs_updated before update on public.exam_configs
  for each row execute function public.tg_set_updated_at();

create table if not exists public.exam_papers (
  id                uuid primary key default gen_random_uuid(),
  config_id         uuid not null references public.exam_configs(id) on delete cascade,
  paper_number      smallint not null check (paper_number between 1 and 9),
  title             text not null,
  kind              text not null default 'objective' check (kind in ('objective','viva','caosce')),
  question_count    int not null default 0 check (question_count between 0 and 400),
  duration_minutes  int not null default 60 check (duration_minutes between 1 and 600),
  pool_id           uuid references public.question_pools(id) on delete set null,
  pass_mark_percent numeric(5,2) check (pass_mark_percent is null or pass_mark_percent between 0 and 100),
  review_policy     text not null default 'after_submit' check (review_policy in ('none','after_submit')),
  shuffle_options   boolean not null default true,
  instructions      text,
  created_at        timestamptz not null default now(),
  unique (config_id, paper_number)
);

create or replace function public.tg_paper_pool_bank()
returns trigger language plpgsql as $$
declare sec text; pb public.question_bank;
begin
  if new.pool_id is null then return new; end if;
  select section into sec from public.exam_configs where id = new.config_id;
  select bank into pb from public.question_pools where id = new.pool_id;
  if (sec = 'C' and pb <> 'section_c') or (sec = 'D' and pb <> 'section_d') then
    raise exception 'paper_pool_mismatch: Section % papers must use a % pool', sec,
      case sec when 'C' then 'section_c' else 'section_d' end;
  end if;
  return new;
end $$;
drop trigger if exists paper_pool_bank on public.exam_papers;
create or replace trigger paper_pool_bank before insert or update on public.exam_papers
  for each row execute function public.tg_paper_pool_bank();

create table if not exists public.exam_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  paper_id     uuid not null references public.exam_papers(id) on delete cascade,
  status       text not null default 'in_progress' check (status in ('in_progress','submitted','expired')),
  started_at   timestamptz not null default now(),
  deadline_at  timestamptz not null,
  submitted_at timestamptz,
  score        int,
  total        int not null default 0,
  percent      numeric(5,2),
  last_seen_at timestamptz not null default now()
);
create index if not exists exam_attempts_user on public.exam_attempts(user_id, started_at desc);
create unique index if not exists exam_attempts_one_open
  on public.exam_attempts(user_id, paper_id) where status = 'in_progress';

create table if not exists public.exam_attempt_items (
  attempt_id         uuid not null references public.exam_attempts(id) on delete cascade,
  position           int not null,
  question_id        uuid not null references public.questions(id) on delete cascade,
  option_order       uuid[] not null,
  selected_option_id uuid references public.question_options(id) on delete set null,
  flagged            boolean not null default false,
  answered_at        timestamptz,
  is_correct         boolean,
  primary key (attempt_id, position)
);

-- ---------- Paper 4: viva & CAOSCE-style stations ----------------------
create table if not exists public.clinical_stations (
  id                     uuid primary key default gen_random_uuid(),
  bank                   public.question_bank not null default 'practice',
  kind                   text not null check (kind in ('viva','caosce')),
  title                  text not null,
  scenario               text not null,
  candidate_instructions text,
  examiner_notes         text,          -- private: revealed only after submission
  duration_minutes       int not null default 10 check (duration_minutes between 1 and 120),
  status                 public.publication_status not null default 'draft',
  source_reference       text,
  topic_id               uuid references public.topics(id) on delete set null,
  is_demo                boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create or replace trigger clinical_stations_updated before update on public.clinical_stations
  for each row execute function public.tg_set_updated_at();

create table if not exists public.station_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  station_id  uuid not null references public.clinical_stations(id) on delete cascade,
  position    int not null default 0,
  step        text not null,
  points      numeric(5,2) not null default 1 check (points >= 0),
  is_critical boolean not null default false
);

create table if not exists public.station_viva_questions (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid not null references public.clinical_stations(id) on delete cascade,
  position        int not null default 0,
  prompt          text not null,
  expected_points text,               -- private marking guide
  marks           numeric(5,2) not null default 1 check (marks >= 0)
);

create table if not exists public.exam_paper_stations (
  paper_id   uuid not null references public.exam_papers(id) on delete cascade,
  station_id uuid not null references public.clinical_stations(id) on delete cascade,
  position   int not null default 0,
  primary key (paper_id, station_id)
);

create table if not exists public.station_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  station_id      uuid not null references public.clinical_stations(id) on delete cascade,
  viva_answers    jsonb not null default '{}',   -- { viva_question_id: "typed answer" }
  checklist_ticks uuid[] not null default '{}',  -- self-assessed checklist items
  self_score      numeric(6,2),
  max_score       numeric(6,2),
  ai_feedback     text,
  created_at      timestamptz not null default now()
);
create index if not exists station_attempts_user on public.station_attempts(user_id, created_at desc);

reset search_path;

-- >>>>>>>>>> 20261028000500_learning.sql
-- =====================================================================
-- 0500 PERSONAL LEARNING (Sections A & E): bookmarks, highlights,
-- personal notes, reading progress, flashcards (SRS), goals, timetable,
-- activity log, notifications.  Every row belongs to one user.
-- =====================================================================

create table if not exists public.bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id     uuid references public.notes(id) on delete cascade,
  question_id uuid references public.questions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (num_nonnulls(note_id, question_id) = 1)
);
create unique index if not exists bookmarks_note_uq on public.bookmarks(user_id, note_id) where note_id is not null;
create unique index if not exists bookmarks_q_uq on public.bookmarks(user_id, question_id) where question_id is not null;

create table if not exists public.highlights (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id    uuid not null references public.notes(id) on delete cascade,
  quote      text not null check (char_length(quote) between 1 and 4000),
  color      text not null default 'yellow' check (color in ('yellow','green','blue','pink')),
  comment    text check (char_length(comment) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists highlights_user_note on public.highlights(user_id, note_id);

create table if not exists public.personal_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id    uuid references public.notes(id) on delete set null,
  topic_id   uuid references public.topics(id) on delete set null,
  title      text not null default 'My note' check (char_length(title) <= 200),
  body       text not null default '' check (char_length(body) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists personal_notes_user on public.personal_notes(user_id, updated_at desc);
create or replace trigger personal_notes_updated before update on public.personal_notes
  for each row execute function public.tg_set_updated_at();

create table if not exists public.reading_progress (
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  note_id        uuid not null references public.notes(id) on delete cascade,
  percent        smallint not null default 0 check (percent between 0 and 100),
  completed      boolean not null default false,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
create index if not exists reading_progress_recent on public.reading_progress(user_id, last_viewed_at desc);

create table if not exists public.flashcards (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  deck             text not null default 'General' check (char_length(deck) <= 80),
  front            text not null check (char_length(front) between 1 and 2000),
  back             text not null check (char_length(back) between 1 and 4000),
  source           text not null default 'manual' check (source in ('manual','ai','note')),
  note_id          uuid references public.notes(id) on delete set null,
  ease             numeric(4,2) not null default 2.5 check (ease >= 1.3),
  interval_days    int not null default 0 check (interval_days >= 0),
  repetitions      int not null default 0,
  due_at           timestamptz not null default now(),
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists flashcards_due on public.flashcards(user_id, due_at);

create table if not exists public.study_goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period     text not null check (period in ('daily','weekly')),
  metric     text not null check (metric in ('questions','notes','flashcards','minutes')),
  target     int not null check (target between 1 and 10000),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, period, metric)
);

create table if not exists public.timetable_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  start_time  time not null,
  end_time    time not null,
  title       text not null check (char_length(title) between 1 and 120),
  course_id   uuid references public.courses(id) on delete set null,
  remind      boolean not null default false,
  created_at  timestamptz not null default now(),
  check (end_time > start_time)
);
create index if not exists timetable_user on public.timetable_entries(user_id, day_of_week, start_time);

-- Lightweight activity log for streaks, revision history and goal tracking.
create table if not exists public.study_activity (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('note_read','question_answered','flashcard_reviewed','exam_submitted','study_minutes')),
  ref_id     uuid,
  amount     int not null default 1 check (amount between 0 and 1440),
  created_at timestamptz not null default now()
);
create index if not exists study_activity_user on public.study_activity(user_id, created_at desc);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications(user_id, created_at desc);

reset search_path;

-- >>>>>>>>>> 20261028000600_ai_credits.sql
-- =====================================================================
-- 0600 AI PLANS, CREDIT WALLETS, LEDGER, REQUEST LOG
-- Credits are only moved by ai_reserve / ai_complete (service role) and
-- admin RPCs. Wallet rows are locked FOR UPDATE, so concurrent requests
-- cannot overspend, and idempotency keys prevent double deductions.
-- =====================================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
create or replace trigger app_settings_updated before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz not null default now()
);
create or replace trigger feature_flags_updated before update on public.feature_flags
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_plans (
  code               text primary key check (code ~ '^[a-z_]{2,20}$'),
  name               text not null,
  monthly_credits    int not null check (monthly_credits >= 0),
  price_kobo         int not null default 0 check (price_kobo >= 0),
  period_days        int not null default 30 check (period_days between 1 and 366),
  image_limit        int not null default 0 check (image_limit >= 0),
  web_search_limit   int not null default 0 check (web_search_limit >= 0),
  video_search_limit int not null default 0 check (video_search_limit >= 0),
  allowed_actions    text[] not null default '{*}',  -- '*' = every enabled action
  position           int not null default 0,
  active             boolean not null default true,
  updated_at         timestamptz not null default now()
);
create or replace trigger ai_plans_updated before update on public.ai_plans
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_action_costs (
  action                text primary key,
  label                 text not null,
  credits               int not null check (credits > 0),
  tier                  text not null check (tier in ('fast','strong','image','web_search','video_search')),
  max_output_tokens     int not null default 800 check (max_output_tokens between 50 and 8000),
  est_provider_cost_usd numeric(10,5) not null default 0,  -- fallback estimate per request
  enabled               boolean not null default true,
  description           text,
  updated_at            timestamptz not null default now()
);
create or replace trigger ai_action_costs_updated before update on public.ai_action_costs
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_code  text not null references public.ai_plans(code),
  status     text not null default 'active' check (status in ('active','expired','cancelled')),
  source     text not null check (source in ('payment','admin_grant','promo')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  payment_id uuid,             -- FK added in 0700
  granted_by uuid references auth.users(id),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists ai_subscriptions_user on public.ai_subscriptions(user_id, ends_at desc);

create table if not exists public.credit_wallets (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  plan_code           text not null default 'free' references public.ai_plans(code),
  balance             int not null default 0 check (balance >= 0),
  period_start        timestamptz not null default now(),
  period_end          timestamptz not null default now(),   -- past => refreshed on next use
  images_used         int not null default 0 check (images_used >= 0),
  web_searches_used   int not null default 0 check (web_searches_used >= 0),
  video_searches_used int not null default 0 check (video_searches_used >= 0),
  updated_at          timestamptz not null default now()
);

create table if not exists public.ai_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  action           text not null references public.ai_action_costs(action),
  status           text not null default 'reserved' check (status in ('reserved','succeeded','failed','refunded')),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 100),
  credits_reserved int not null,
  credits_charged  int not null default 0,
  provider         text,
  model            text,
  input_tokens     int,
  output_tokens    int,
  est_cost_usd     numeric(10,5),
  latency_ms       int,
  error_code       text,
  context          jsonb not null default '{}',   -- ids only (note/question), never personal data
  output_excerpt   text,                          -- kept for error reports / review
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (user_id, idempotency_key)
);
create index if not exists ai_requests_user_time on public.ai_requests(user_id, created_at desc);
create index if not exists ai_requests_time on public.ai_requests(created_at desc);

create table if not exists public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         int not null,
  balance_after int not null check (balance_after >= 0),
  reason        text not null check (reason in ('period_grant','period_expire','plan_purchase','ai_reserve','ai_refund','admin_adjustment')),
  ai_request_id uuid references public.ai_requests(id) on delete set null,
  actor_id      uuid references auth.users(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists credit_ledger_user on public.credit_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Internal: fetch + lock a wallet, creating it and rolling the monthly
-- period when needed. Caller must already be inside a transaction.
-- ---------------------------------------------------------------------
create or replace function public._wallet_lock(p_user uuid)
returns public.credit_wallets
language plpgsql security definer set search_path = public as $$
declare
  w public.credit_wallets;
  v_plan public.ai_plans;
  v_code text;
begin
  insert into public.credit_wallets(user_id) values (p_user) on conflict do nothing;
  select * into w from public.credit_wallets where user_id = p_user for update;

  if now() >= w.period_end then
    -- Highest active paid plan, else free.
    select s.plan_code into v_code
      from public.ai_subscriptions s join public.ai_plans p on p.code = s.plan_code
     where s.user_id = p_user and s.status = 'active' and s.starts_at <= now() and s.ends_at > now()
     order by p.monthly_credits desc limit 1;
    v_code := coalesce(v_code, 'free');
    select * into v_plan from public.ai_plans where code = v_code;
    if not found then
      raise exception 'ai_plan_missing:%', v_code;
    end if;

    if w.balance > 0 then
      insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
      values (p_user, -w.balance, 0, 'period_expire', 'Unused credits expire at period end');
    end if;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
    values (p_user, v_plan.monthly_credits, v_plan.monthly_credits, 'period_grant', v_plan.name || ' monthly credits');

    update public.credit_wallets set
      plan_code = v_code, balance = v_plan.monthly_credits,
      period_start = now(),
      period_end = least(now() + make_interval(days => v_plan.period_days),
                         coalesce((select max(ends_at) from public.ai_subscriptions
                                    where user_id = p_user and plan_code = v_code and status = 'active'
                                      and v_code <> 'free'), 'infinity')),
      images_used = 0, web_searches_used = 0, video_searches_used = 0, updated_at = now()
    where user_id = p_user
    returning * into w;
  end if;
  return w;
end $$;

-- ---------------------------------------------------------------------
-- ai_reserve: validate + deduct credits BEFORE calling the provider.
-- Returns jsonb { ok, request_id, credits, balance, duplicate, error }.
-- ---------------------------------------------------------------------
create or replace function public.ai_reserve(p_user uuid, p_action text, p_idem text, p_context jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w public.credit_wallets;
  v_cost public.ai_action_costs;
  v_plan public.ai_plans;
  v_existing public.ai_requests;
  v_cfg jsonb;
  v_recent int;
  v_spent numeric;
  v_req uuid;
begin
  -- Idempotency: same key returns the original reservation, no new charge.
  select * into v_existing from public.ai_requests where user_id = p_user and idempotency_key = p_idem;
  if found then
    return jsonb_build_object('ok', v_existing.status in ('reserved','succeeded'), 'duplicate', true,
      'request_id', v_existing.id, 'status', v_existing.status, 'credits', v_existing.credits_reserved,
      'error', case when v_existing.status in ('failed','refunded') then 'previous_attempt_failed' end);
  end if;

  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'account_suspended');
  end if;

  select * into v_cost from public.ai_action_costs where action = p_action;
  if not found or not v_cost.enabled then
    return jsonb_build_object('ok', false, 'error', 'action_disabled');
  end if;

  select coalesce(value, '{}') into v_cfg from public.app_settings where key = 'ai.config';
  v_cfg := coalesce(v_cfg, '{}');

  -- Global kill switch & daily provider budget cap.
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'error', 'ai_disabled');
  end if;
  select coalesce(sum(coalesce(est_cost_usd, 0)), 0) into v_spent
    from public.ai_requests where created_at >= date_trunc('day', now()) and status <> 'refunded';
  if (v_cfg ? 'daily_budget_usd') and v_spent >= (v_cfg->>'daily_budget_usd')::numeric then
    return jsonb_build_object('ok', false, 'error', 'budget_exceeded');
  end if;

  w := public._wallet_lock(p_user);   -- row lock serialises this user's requests

  -- Per-user rate limit (requests per minute).
  select count(*) into v_recent from public.ai_requests
   where user_id = p_user and created_at > now() - interval '1 minute';
  if v_recent >= coalesce((v_cfg->>'per_user_per_minute')::int, 10) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select * into v_plan from public.ai_plans where code = w.plan_code;
  if not (v_plan.allowed_actions @> array['*'] or v_plan.allowed_actions @> array[p_action]) then
    return jsonb_build_object('ok', false, 'error', 'plan_upgrade_required', 'plan', w.plan_code);
  end if;
  if v_cost.tier = 'image' and w.images_used >= v_plan.image_limit then
    return jsonb_build_object('ok', false, 'error', 'image_limit_reached', 'limit', v_plan.image_limit);
  end if;
  if v_cost.tier = 'web_search' and w.web_searches_used >= v_plan.web_search_limit then
    return jsonb_build_object('ok', false, 'error', 'web_search_limit_reached', 'limit', v_plan.web_search_limit);
  end if;
  if v_cost.tier = 'video_search' and w.video_searches_used >= v_plan.video_search_limit then
    return jsonb_build_object('ok', false, 'error', 'video_search_limit_reached', 'limit', v_plan.video_search_limit);
  end if;
  if w.balance < v_cost.credits then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits',
      'balance', w.balance, 'credits', v_cost.credits);
  end if;

  insert into public.ai_requests(user_id, action, idempotency_key, credits_reserved, context)
  values (p_user, p_action, p_idem, v_cost.credits, coalesce(p_context, '{}'))
  returning id into v_req;

  update public.credit_wallets set
    balance = balance - v_cost.credits,
    images_used = images_used + (v_cost.tier = 'image')::int,
    web_searches_used = web_searches_used + (v_cost.tier = 'web_search')::int,
    video_searches_used = video_searches_used + (v_cost.tier = 'video_search')::int,
    updated_at = now()
  where user_id = p_user
  returning * into w;

  insert into public.credit_ledger(user_id, delta, balance_after, reason, ai_request_id)
  values (p_user, -v_cost.credits, w.balance, 'ai_reserve', v_req);

  return jsonb_build_object('ok', true, 'duplicate', false, 'request_id', v_req,
    'credits', v_cost.credits, 'balance', w.balance, 'tier', v_cost.tier,
    'max_output_tokens', v_cost.max_output_tokens, 'est_cost_usd', v_cost.est_provider_cost_usd);
end $$;

-- ---------------------------------------------------------------------
-- ai_complete: settle a reservation. Failure => full refund.
-- Idempotent: only acts while status = 'reserved'.
-- ---------------------------------------------------------------------
create or replace function public.ai_complete(
  p_request uuid, p_success boolean,
  p_provider text default null, p_model text default null,
  p_input_tokens int default null, p_output_tokens int default null,
  p_cost_usd numeric default null, p_latency_ms int default null,
  p_error text default null, p_excerpt text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.ai_requests;
  v_tier text;
  w public.credit_wallets;
begin
  select * into r from public.ai_requests where id = p_request for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'request_not_found'); end if;
  if r.status <> 'reserved' then
    select * into w from public.credit_wallets where user_id = r.user_id;
    return jsonb_build_object('ok', true, 'already_settled', true, 'status', r.status, 'balance', w.balance);
  end if;

  if p_success then
    update public.ai_requests set status = 'succeeded', credits_charged = credits_reserved,
      provider = p_provider, model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      est_cost_usd = p_cost_usd, latency_ms = p_latency_ms, output_excerpt = left(p_excerpt, 4000),
      completed_at = now()
    where id = p_request;
    select * into w from public.credit_wallets where user_id = r.user_id;
    return jsonb_build_object('ok', true, 'status', 'succeeded', 'balance', w.balance);
  end if;

  select tier into v_tier from public.ai_action_costs where action = r.action;
  perform 1 from public.credit_wallets where user_id = r.user_id for update;
  update public.credit_wallets set
    balance = balance + r.credits_reserved,
    images_used = greatest(images_used - (v_tier = 'image')::int, 0),
    web_searches_used = greatest(web_searches_used - (v_tier = 'web_search')::int, 0),
    video_searches_used = greatest(video_searches_used - (v_tier = 'video_search')::int, 0),
    updated_at = now()
  where user_id = r.user_id
  returning * into w;

  insert into public.credit_ledger(user_id, delta, balance_after, reason, ai_request_id, note)
  values (r.user_id, r.credits_reserved, w.balance, 'ai_refund', r.id, left(coalesce(p_error, 'failed'), 200));

  update public.ai_requests set status = 'refunded', credits_charged = 0,
    provider = p_provider, model = p_model, latency_ms = p_latency_ms,
    est_cost_usd = coalesce(p_cost_usd, 0), error_code = left(p_error, 200), completed_at = now()
  where id = p_request;

  return jsonb_build_object('ok', true, 'status', 'refunded', 'balance', w.balance);
end $$;

-- Student-facing: read (and lazily roll) my own wallet.
create or replace function public.my_wallet()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); w public.credit_wallets; p public.ai_plans;
begin
  w := public._wallet_lock(uid);
  select * into p from public.ai_plans where code = w.plan_code;
  return jsonb_build_object(
    'plan_code', w.plan_code, 'plan_name', p.name, 'balance', w.balance,
    'monthly_credits', p.monthly_credits, 'period_end', w.period_end,
    'images_used', w.images_used, 'image_limit', p.image_limit,
    'web_searches_used', w.web_searches_used, 'web_search_limit', p.web_search_limit,
    'video_searches_used', w.video_searches_used, 'video_search_limit', p.video_search_limit);
end $$;

reset search_path;

-- >>>>>>>>>> 20261028000700_payments_entitlements.sql
-- =====================================================================
-- 0700 PRODUCTS, PAYMENTS, WEBHOOK EVENTS, REFUNDS, ENTITLEMENTS
-- Section C and Section D are separate products; buying one never grants
-- the other. Access is an explicit entitlement row with source + expiry.
-- payment_fulfill() is idempotent and only callable by the service role.
-- =====================================================================

create table if not exists public.products (
  code        text primary key check (code ~ '^[a-z_]{2,30}$'),
  name        text not null,
  description text,
  price_kobo  int not null check (price_kobo >= 0),
  currency    text not null default 'NGN' check (currency = 'NGN'),
  access_days int check (access_days is null or access_days > 0),  -- null = until revoked
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create or replace trigger products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete restrict,
  reference               text not null unique check (char_length(reference) between 10 and 100),
  purpose                 text not null check (purpose in ('product','ai_plan')),
  item_code               text not null,
  amount_kobo             int not null check (amount_kobo > 0),
  currency                text not null default 'NGN',
  status                  text not null default 'initialized'
                          check (status in ('initialized','success','failed','abandoned','refunded','amount_mismatch')),
  provider                text not null default 'paystack',
  mode                    text not null default 'test' check (mode in ('test','live')),
  provider_transaction_id text,
  channel                 text,
  paid_at                 timestamptz,
  verified_at             timestamptz,
  metadata                jsonb not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists payments_user on public.payments(user_id, created_at desc);
create index if not exists payments_status on public.payments(status, created_at desc);
create or replace trigger payments_updated before update on public.payments
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payment_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'paystack',
  event_key        text not null,            -- sha256 of raw body: duplicate deliveries collide
  event_type       text,
  reference        text,
  signature_valid  boolean not null,
  payload          jsonb not null,
  processed        boolean not null default false,
  processing_error text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (provider, event_key)
);
create index if not exists payment_events_ref on public.payment_events(reference);

create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments(id),
  amount_kobo  int not null check (amount_kobo > 0),
  reason       text not null,
  status       text not null default 'recorded' check (status in ('recorded','processed','failed')),
  processed_by uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create table if not exists public.entitlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.products(code),
  source       text not null check (source in ('payment','admin_grant','promo')),
  status       text not null default 'active' check (status in ('active','revoked','expired')),
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz,
  payment_id   uuid unique references public.payments(id),   -- one entitlement per payment
  granted_by   uuid references auth.users(id),
  reason       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (source <> 'payment' or payment_id is not null),
  check (source = 'payment' or granted_by is not null or source = 'promo')
);
create index if not exists entitlements_user on public.entitlements(user_id, product_code);
create or replace trigger entitlements_updated before update on public.entitlements
  for each row execute function public.tg_set_updated_at();

do $$ begin
  alter table public.ai_subscriptions
    add constraint ai_subscriptions_payment_fk foreign key (payment_id) references public.payments(id);
exception when duplicate_object then null; end $$;
create unique index if not exists ai_subscriptions_payment_uq on public.ai_subscriptions(payment_id) where payment_id is not null;

-- Does a user currently hold access to a product?
create or replace function public.user_has_entitlement(p_user uuid, p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements
     where user_id = p_user and product_code = p_product and status = 'active'
       and starts_at <= now() and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.has_entitlement(p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_entitlement(auth.uid(), p_product);
$$;

-- Which product unlocks a bank / section.
create or replace function public.bank_product(p_bank public.question_bank)
returns text language sql immutable as $$
  select case p_bank when 'section_c' then 'section_c' when 'section_d' then 'section_d' else null end;
$$;

-- ---------------------------------------------------------------------
-- payment_fulfill: called by the server ONLY after verifying the
-- transaction with Paystack's API. Safe to call repeatedly.
-- ---------------------------------------------------------------------
create or replace function public.payment_fulfill(
  p_reference text, p_amount_kobo int, p_currency text,
  p_provider_txn text, p_channel text, p_paid_at timestamptz, p_raw jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pay public.payments;
  prod public.products;
  plan public.ai_plans;
  w public.credit_wallets;
  v_ent uuid;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_reference'); end if;

  if pay.status = 'success' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'payment_id', pay.id);
  end if;
  if pay.status in ('refunded') then
    return jsonb_build_object('ok', false, 'error', 'payment_refunded');
  end if;

  -- Never trust the client: amount and currency must match what WE priced.
  if p_amount_kobo is distinct from pay.amount_kobo or upper(coalesce(p_currency, '')) <> pay.currency then
    update public.payments set status = 'amount_mismatch', verified_at = now(),
      metadata = metadata || jsonb_build_object('verify', p_raw) where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  update public.payments set status = 'success', provider_transaction_id = p_provider_txn,
    channel = p_channel, paid_at = coalesce(p_paid_at, now()), verified_at = now(),
    metadata = metadata || jsonb_build_object('verify', p_raw)
  where id = pay.id;

  if pay.purpose = 'product' then
    select * into prod from public.products where code = pay.item_code;
    insert into public.entitlements(user_id, product_code, source, payment_id, starts_at, expires_at, reason)
    values (pay.user_id, pay.item_code, 'payment', pay.id, now(),
            case when prod.access_days is null then null else now() + make_interval(days => prod.access_days) end,
            'Paystack ' || p_reference)
    on conflict (payment_id) do nothing
    returning id into v_ent;

    insert into public.notifications(user_id, title, body, link)
    values (pay.user_id, prod.name || ' unlocked', 'Your payment was confirmed. Good luck with your preparation!',
            case pay.item_code when 'section_c' then '/mock' else '/final' end);

    return jsonb_build_object('ok', true, 'payment_id', pay.id, 'entitlement_id', v_ent);
  else
    select * into plan from public.ai_plans where code = pay.item_code;
    insert into public.ai_subscriptions(user_id, plan_code, source, payment_id, starts_at, ends_at, reason)
    values (pay.user_id, plan.code, 'payment', pay.id, now(), now() + make_interval(days => plan.period_days),
            'Paystack ' || p_reference)
    on conflict do nothing;

    -- Start a fresh period on the new plan; unused credits carry over once.
    w := public._wallet_lock(pay.user_id);
    update public.credit_wallets set
      plan_code = plan.code,
      balance = w.balance + plan.monthly_credits,
      period_start = now(), period_end = now() + make_interval(days => plan.period_days),
      images_used = 0, web_searches_used = 0, video_searches_used = 0, updated_at = now()
    where user_id = pay.user_id returning * into w;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
    values (pay.user_id, plan.monthly_credits, w.balance, 'plan_purchase', plan.name || ' plan purchased');

    insert into public.notifications(user_id, title, body, link)
    values (pay.user_id, plan.name || ' AI plan active', format('%s credits added to your wallet.', plan.monthly_credits), '/dashboard');

    return jsonb_build_object('ok', true, 'payment_id', pay.id, 'plan', plan.code, 'balance', w.balance);
  end if;
end $$;

-- Mark a non-successful verification outcome (failed/abandoned).
create or replace function public.payment_mark(p_reference text, p_status text, p_raw jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('failed','abandoned') then raise exception 'invalid_status'; end if;
  update public.payments set status = p_status, verified_at = now(),
         metadata = metadata || jsonb_build_object('verify', p_raw)
   where reference = p_reference and status = 'initialized';
end $$;

reset search_path;

-- >>>>>>>>>> 20261028000800_admin_audit_reports.sql
-- =====================================================================
-- 0800 AUDIT LOG, CONTENT/ERROR REPORTS, SUPPORT TICKETS
-- =====================================================================

create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,          -- INSERT / UPDATE / DELETE / custom verb
  entity_type text not null,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_logs_time on public.audit_logs(created_at desc);
create index if not exists audit_logs_entity on public.audit_logs(entity_type, entity_id);

-- Append-only: block edits/deletes even by table owner roles other than postgres.
create or replace function public.tg_audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs_are_append_only';
end $$;
drop trigger if exists audit_logs_immutable on public.audit_logs;
create or replace trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.tg_audit_immutable();

create or replace function public.audit(p_action text, p_entity text, p_id text, p_before jsonb, p_after jsonb, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, before, after, note)
  values (auth.uid(), p_action, p_entity, p_id, p_before, p_after, p_note);
end $$;

-- Generic row-level audit trigger for sensitive tables.
create or replace function public.tg_audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if tg_op = 'DELETE' then
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'code', to_jsonb(old)->>'key', to_jsonb(old)->>'user_id', to_jsonb(old)->>'action');
    perform public.audit(tg_op, tg_table_name, v_id, to_jsonb(old), null);
    return old;
  end if;
  v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'code', to_jsonb(new)->>'key', to_jsonb(new)->>'user_id', to_jsonb(new)->>'action');
  if tg_op = 'UPDATE' then
    if to_jsonb(old) = to_jsonb(new) then return new; end if;
    perform public.audit(tg_op, tg_table_name, v_id, to_jsonb(old), to_jsonb(new));
  else
    perform public.audit(tg_op, tg_table_name, v_id, null, to_jsonb(new));
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'user_roles','role_permissions','entitlements','ai_subscriptions','products','ai_plans',
    'ai_action_costs','app_settings','feature_flags','refunds','exam_configs','exam_papers'
  ] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.tg_audit_row()', t);
  end loop;
end $$;

-- Status changes on profiles (suspension) are audited; profile edits are not.
create or replace function public.tg_audit_profile_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform public.audit('STATUS', 'profiles', new.id::text,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status, 'reason', new.suspended_reason));
  end if;
  return new;
end $$;
drop trigger if exists audit_profile_status on public.profiles;
create or replace trigger audit_profile_status after update of status on public.profiles
  for each row execute function public.tg_audit_profile_status();

-- ---------- Reports of incorrect content / AI errors -------------------
create table if not exists public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('note','question','ai_response','station','other')),
  target_id   uuid,
  reason      text not null check (reason in ('incorrect','outdated','unclear','typo','offensive','copyright','other')),
  details     text check (char_length(details) <= 4000),
  status      text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  admin_notes text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists content_reports_status on public.content_reports(status, created_at desc);

-- ---------- Support tickets ------------------------------------------
create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject     text not null check (char_length(subject) between 3 and 200),
  body        text not null check (char_length(body) between 3 and 6000),
  category    text not null default 'general' check (category in ('general','payment','access','content','technical')),
  status      text not null default 'open' check (status in ('open','pending','closed')),
  admin_reply text,
  replied_by  uuid references auth.users(id),
  replied_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists support_tickets_status on public.support_tickets(status, created_at desc);
create or replace trigger support_tickets_updated before update on public.support_tickets
  for each row execute function public.tg_set_updated_at();

reset search_path;

-- >>>>>>>>>> 20261028000900_student_rpcs.sql
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

reset search_path;

-- >>>>>>>>>> 20261028001000_admin_rpcs.sql
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

reset search_path;

-- >>>>>>>>>> 20261028001100_rls_policies.sql
-- =====================================================================
-- 1100 ROW LEVEL SECURITY, COLUMN GRANTS, FUNCTION PRIVILEGES
-- Principle: students read published content + their own rows; all
-- score/credit/payment/role changes go through checked RPCs.
-- =====================================================================

-- ---------- Enable RLS on every table in public -----------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------- Explicit API grants ---------------------------------------
-- Works whether or not "Automatically expose new tables" is enabled in the
-- Supabase dashboard (recommended: disabled). RLS policies below decide which
-- ROWS each role sees; the revokes further down remove privileges students
-- must never have. Nothing is granted to anon here (see end of file).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Helper to keep policy creation idempotent.
create or replace function public._policy(p_table text, p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute p_sql;
end $$;

-- ---------- Reference data readable by everyone ----------------------
select public._policy('programmes', 'programmes_read', $p$create policy programmes_read on public.programmes for select using (true)$p$);
select public._policy('programmes', 'programmes_admin', $p$create policy programmes_admin on public.programmes for all
  using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$p$);

select public._policy('products', 'products_read', $p$create policy products_read on public.products for select using (active or public.has_permission('pricing.manage'))$p$);
select public._policy('products', 'products_admin', $p$create policy products_admin on public.products for all
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'))$p$);

select public._policy('ai_plans', 'ai_plans_read', $p$create policy ai_plans_read on public.ai_plans for select using (active or public.has_permission('pricing.manage'))$p$);
select public._policy('ai_plans', 'ai_plans_admin', $p$create policy ai_plans_admin on public.ai_plans for all
  using (public.has_permission('pricing.manage') or public.has_permission('ai.manage'))
  with check (public.has_permission('pricing.manage') or public.has_permission('ai.manage'))$p$);

select public._policy('ai_action_costs', 'ai_costs_read', $p$create policy ai_costs_read on public.ai_action_costs for select using (true)$p$);
select public._policy('ai_action_costs', 'ai_costs_admin', $p$create policy ai_costs_admin on public.ai_action_costs for all
  using (public.has_permission('ai.manage')) with check (public.has_permission('ai.manage'))$p$);

select public._policy('feature_flags', 'flags_read', $p$create policy flags_read on public.feature_flags for select using (true)$p$);
select public._policy('feature_flags', 'flags_admin', $p$create policy flags_admin on public.feature_flags for all
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'))$p$);

select public._policy('app_settings', 'settings_admin', $p$create policy settings_admin on public.app_settings for all
  using (public.has_permission('settings.manage') or (key like 'ai.%' and public.has_permission('ai.manage')))
  with check (public.has_permission('settings.manage') or (key like 'ai.%' and public.has_permission('ai.manage')))$p$);

select public._policy('role_permissions', 'role_perms_read', $p$create policy role_perms_read on public.role_permissions for select to authenticated using (true)$p$);

-- ---------- Profiles & roles ----------------------------------------
select public._policy('profiles', 'profiles_self_read', $p$create policy profiles_self_read on public.profiles for select
  using (id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('profiles', 'profiles_self_update', $p$create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid())$p$);

-- Students may only edit these profile columns (status/email are server-managed).
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, programme_id, curriculum_version_id, institution, exam_target_date, onboarded)
  on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

select public._policy('user_roles', 'roles_read', $p$create policy roles_read on public.user_roles for select
  using (user_id = auth.uid() or public.has_permission('roles.manage') or public.has_permission('users.view'))$p$);
revoke insert, update, delete on public.user_roles from anon, authenticated;

-- ---------- Curriculum & library content ------------------------------
do $$
declare t text;
begin
  foreach t in array array['curriculum_versions','courses','modules','topics','notes'] loop
    perform public._policy(t, t || '_read', format($f$create policy %I on public.%I for select
      using (status = 'published' or public.has_permission('content.manage') or public.has_permission('content.review'))$f$, t || '_read', t));
    perform public._policy(t, t || '_write', format($f$create policy %I on public.%I for insert
      with check (public.has_permission('content.manage'))$f$, t || '_write', t));
    perform public._policy(t, t || '_update', format($f$create policy %I on public.%I for update
      using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$f$, t || '_update', t));
    -- Only never-published drafts can be hard-deleted; everything else is archived.
    perform public._policy(t, t || '_delete', format($f$create policy %I on public.%I for delete
      using (public.has_permission('content.manage') and status = 'draft')$f$, t || '_delete', t));
  end loop;
end $$;

select public._policy('course_programmes', 'cp_read', $p$create policy cp_read on public.course_programmes for select using (true)$p$);
select public._policy('course_programmes', 'cp_admin', $p$create policy cp_admin on public.course_programmes for all
  using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$p$);

-- Students see only the version currently published for a published note.
select public._policy('note_versions', 'nv_read', $p$create policy nv_read on public.note_versions for select using (
  public.has_permission('content.manage') or public.has_permission('content.review')
  or exists (select 1 from public.notes n where n.current_version_id = note_versions.id and n.status = 'published'))$p$);
select public._policy('note_versions', 'nv_insert', $p$create policy nv_insert on public.note_versions for insert
  with check (public.has_permission('content.manage') and status in ('draft','in_review'))$p$);
-- Editors may change drafts; approval happens only through admin_review_note_version().
select public._policy('note_versions', 'nv_update', $p$create policy nv_update on public.note_versions for update
  using (public.has_permission('content.manage') and status in ('draft','rejected'))
  with check (status in ('draft','rejected','in_review'))$p$);

do $$
declare t text;
begin
  foreach t in array array['note_attachments','note_references'] loop
    perform public._policy(t, t || '_read', format($f$create policy %I on public.%I for select using (
      public.has_permission('content.manage') or exists (select 1 from public.notes n where n.id = %I.note_id and n.status = 'published'))$f$,
      t || '_read', t, t));
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$f$, t || '_admin', t));
  end loop;
end $$;

-- ---------- Questions -------------------------------------------------
-- Students may read published PRACTICE question stems (e.g. saved list).
-- Exam-bank questions are never directly readable by students.
select public._policy('questions', 'q_read', $p$create policy q_read on public.questions for select using (
  (bank = 'practice' and status = 'published')
  or public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
select public._policy('questions', 'q_admin_update', $p$create policy q_admin_update on public.questions for update
  using (public.has_permission('questions.manage')) with check (public.has_permission('questions.manage'))$p$);
select public._policy('questions', 'q_admin_delete', $p$create policy q_admin_delete on public.questions for delete
  using (public.has_permission('questions.manage') and status = 'draft')$p$);
-- Inserts go through admin_save_question / admin_import_questions.
revoke insert on public.questions from anon, authenticated;

-- Answer keys & rationales: staff only. Students get them via RPC after answering.
select public._policy('question_options', 'qo_staff', $p$create policy qo_staff on public.question_options for select
  using (public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
revoke insert, update, delete on public.question_options from anon, authenticated;

select public._policy('question_programmes', 'qp_read', $p$create policy qp_read on public.question_programmes for select using (true)$p$);
revoke insert, update, delete on public.question_programmes from anon, authenticated;

select public._policy('question_versions', 'qv_staff', $p$create policy qv_staff on public.question_versions for select
  using (public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
revoke insert, update, delete on public.question_versions from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['question_pools','question_pool_items'] loop
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('questions.manage') or public.has_permission('exams.manage'))
      with check (public.has_permission('questions.manage') or public.has_permission('exams.manage'))$f$, t || '_admin', t));
  end loop;
end $$;

-- ---------- Practice & exams (read own, write via RPC) ----------------
select public._policy('practice_sessions', 'ps_own', $p$create policy ps_own on public.practice_sessions for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('practice_items', 'pi_own', $p$create policy pi_own on public.practice_items for select
  using (exists (select 1 from public.practice_sessions s where s.id = session_id and s.user_id = auth.uid()))$p$);
select public._policy('exam_attempts', 'ea_own', $p$create policy ea_own on public.exam_attempts for select
  using (user_id = auth.uid() or public.has_permission('exams.manage') or public.has_permission('users.view'))$p$);
-- exam_attempt_items: no direct access at all (served by exam_get).
select public._policy('exam_attempt_items', 'eai_staff', $p$create policy eai_staff on public.exam_attempt_items for select
  using (public.has_permission('exams.manage'))$p$);
revoke insert, update, delete on public.practice_sessions, public.practice_items,
  public.exam_attempts, public.exam_attempt_items from anon, authenticated;

select public._policy('exam_configs', 'ec_read', $p$create policy ec_read on public.exam_configs for select
  using (status = 'published' or public.has_permission('exams.manage'))$p$);
select public._policy('exam_configs', 'ec_admin', $p$create policy ec_admin on public.exam_configs for all
  using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$p$);
select public._policy('exam_papers', 'ep_read', $p$create policy ep_read on public.exam_papers for select using (
  public.has_permission('exams.manage') or exists (select 1 from public.exam_configs c where c.id = config_id and c.status = 'published'))$p$);
select public._policy('exam_papers', 'ep_admin', $p$create policy ep_admin on public.exam_papers for all
  using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$p$);

-- Stations: rubric tables are staff-only; students use station_get/station_submit.
do $$
declare t text;
begin
  foreach t in array array['clinical_stations','station_checklist_items','station_viva_questions','exam_paper_stations'] loop
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$f$, t || '_admin', t));
  end loop;
end $$;
select public._policy('station_attempts', 'sa_own', $p$create policy sa_own on public.station_attempts for select
  using (user_id = auth.uid() or public.has_permission('exams.manage'))$p$);
revoke insert, update, delete on public.station_attempts from anon, authenticated;

-- ---------- Personal learning data (full CRUD on own rows) ------------
do $$
declare t text;
begin
  foreach t in array array['bookmarks','highlights','personal_notes','flashcards','study_goals','timetable_entries'] loop
    perform public._policy(t, t || '_own', format($f$create policy %I on public.%I for all
      using (user_id = auth.uid() and public.is_active_user())
      with check (user_id = auth.uid() and public.is_active_user())$f$, t || '_own', t));
  end loop;
end $$;

select public._policy('reading_progress', 'rp_own', $p$create policy rp_own on public.reading_progress for select using (user_id = auth.uid())$p$);
revoke insert, update, delete on public.reading_progress from anon, authenticated;

select public._policy('study_activity', 'sact_own_read', $p$create policy sact_own_read on public.study_activity for select using (user_id = auth.uid())$p$);
-- Clients may log study minutes / flashcard reviews for themselves only.
select public._policy('study_activity', 'sact_own_insert', $p$create policy sact_own_insert on public.study_activity for insert
  with check (user_id = auth.uid() and kind in ('study_minutes','flashcard_reviewed') and public.is_active_user())$p$);
revoke update, delete on public.study_activity from anon, authenticated;

select public._policy('notifications', 'notif_own', $p$create policy notif_own on public.notifications for select using (user_id = auth.uid())$p$);
select public._policy('notifications', 'notif_mark_read', $p$create policy notif_mark_read on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid())$p$);
revoke insert, delete on public.notifications from anon, authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- AI & credits (read own; writes via service-role RPCs) -----
select public._policy('credit_wallets', 'wallet_own', $p$create policy wallet_own on public.credit_wallets for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('credit_ledger', 'ledger_own', $p$create policy ledger_own on public.credit_ledger for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('ai_requests', 'aireq_own', $p$create policy aireq_own on public.ai_requests for select
  using (user_id = auth.uid() or public.has_permission('ai.manage'))$p$);
select public._policy('ai_subscriptions', 'aisub_own', $p$create policy aisub_own on public.ai_subscriptions for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
revoke insert, update, delete on public.credit_wallets, public.credit_ledger, public.ai_requests,
  public.ai_subscriptions from anon, authenticated;

-- ---------- Payments & access ----------------------------------------
select public._policy('payments', 'pay_own', $p$create policy pay_own on public.payments for select
  using (user_id = auth.uid() or public.has_permission('payments.view'))$p$);
select public._policy('entitlements', 'ent_own', $p$create policy ent_own on public.entitlements for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('payment_events', 'pev_staff', $p$create policy pev_staff on public.payment_events for select
  using (public.has_permission('payments.view'))$p$);
select public._policy('refunds', 'refunds_staff', $p$create policy refunds_staff on public.refunds for select
  using (public.has_permission('payments.view'))$p$);
revoke insert, update, delete on public.payments, public.entitlements, public.payment_events, public.refunds
  from anon, authenticated;

-- ---------- Audit, reports, tickets ----------------------------------
select public._policy('audit_logs', 'audit_read', $p$create policy audit_read on public.audit_logs for select
  using (public.has_permission('audit.view'))$p$);
revoke insert, update, delete on public.audit_logs from anon, authenticated;

select public._policy('content_reports', 'cr_read', $p$create policy cr_read on public.content_reports for select
  using (user_id = auth.uid() or public.has_permission('reports.manage'))$p$);
select public._policy('content_reports', 'cr_insert', $p$create policy cr_insert on public.content_reports for insert
  with check (user_id = auth.uid() and status = 'open' and public.is_active_user())$p$);
select public._policy('content_reports', 'cr_admin', $p$create policy cr_admin on public.content_reports for update
  using (public.has_permission('reports.manage')) with check (public.has_permission('reports.manage'))$p$);

select public._policy('support_tickets', 'st_read', $p$create policy st_read on public.support_tickets for select
  using (user_id = auth.uid() or public.has_permission('support.manage'))$p$);
select public._policy('support_tickets', 'st_insert', $p$create policy st_insert on public.support_tickets for insert
  with check (user_id = auth.uid() and status = 'open' and admin_reply is null and public.is_active_user())$p$);
select public._policy('support_tickets', 'st_admin', $p$create policy st_admin on public.support_tickets for update
  using (public.has_permission('support.manage')) with check (public.has_permission('support.manage'))$p$);

-- Anonymous visitors get nothing beyond the public reference tables above.
revoke all on all tables in schema public from anon;
grant select on public.programmes, public.products, public.ai_plans, public.ai_action_costs, public.feature_flags to anon;

drop function public._policy(text, text, text);

-- ---------- Function privileges -------------------------------------
-- Supabase grants EXECUTE on new functions to anon/authenticated by
-- default. Lock everything down, then re-grant the public API.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Helpers used inside RLS policies must stay callable.
grant execute on function public.is_active_user(), public.has_permission(text), public.is_staff(),
  public.has_entitlement(text) to authenticated;

-- Student API
grant execute on function
  public.touch_last_active(),
  public.note_reader(uuid, uuid), public.note_progress(uuid, int), public.search_notes(text, text, int),
  public.practice_start(int, text, uuid, uuid, public.difficulty_level, text), public.practice_get(uuid),
  public.practice_answer(uuid, int, uuid), public.practice_finish(uuid),
  public.exam_catalogue(text), public.exam_start(uuid), public.exam_get(uuid),
  public.exam_save_answer(uuid, int, uuid, boolean), public.exam_submit(uuid), public.exam_result(uuid),
  public.paper_stations(uuid), public.station_get(uuid), public.station_submit(uuid, jsonb),
  public.station_self_assess(uuid, uuid[], jsonb),
  public.my_topic_stats(), public.my_dashboard(), public.my_wallet()
to authenticated;

-- Admin API (each function re-checks permissions internally)
grant execute on function
  public.admin_overview(), public.admin_reorder(text, uuid[]),
  public.admin_submit_note_version(uuid), public.admin_review_note_version(uuid, boolean, text, date),
  public.admin_restore_note_version(uuid), public.admin_set_content_status(text, uuid, public.publication_status),
  public.admin_save_question(jsonb), public.admin_set_question_status(uuid[], public.publication_status),
  public.admin_similar_questions(text, public.question_bank, uuid),
  public.admin_import_questions(jsonb, public.publication_status, boolean, boolean),
  public.admin_user_detail(uuid), public.admin_set_user_status(uuid, public.account_status, text),
  public.admin_set_programme(uuid, text), public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_grant_entitlement(uuid, text, int, text), public.admin_revoke_entitlement(uuid, text),
  public.admin_extend_entitlement(uuid, int), public.admin_grant_plan(uuid, text, int, text),
  public.admin_adjust_credits(uuid, int, text), public.admin_record_refund(uuid, text, int),
  public.admin_broadcast(text, text, text, text), public.admin_ai_usage(int),
  public.question_problems(uuid)
to authenticated;

-- Trusted server only (Edge Functions with the service-role key).
grant execute on function
  public.ai_reserve(uuid, text, text, jsonb),
  public.ai_complete(uuid, boolean, text, text, int, int, numeric, int, text, text),
  public.payment_fulfill(text, int, text, text, text, timestamptz, jsonb),
  public.payment_mark(text, text, jsonb),
  public.user_has_entitlement(uuid, text)
to service_role;

reset search_path;

-- >>>>>>>>>> 20261028001200_storage.sql
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

drop policy if exists "content read by signed-in users" on storage.objects;
create policy "content read by signed-in users" on storage.objects for select to authenticated
  using (bucket_id in ('content','question-images') and public.is_active_user());

drop policy if exists "content managed by editors" on storage.objects;
create policy "content managed by editors" on storage.objects for all to authenticated
  using (
    (bucket_id = 'content' and public.has_permission('content.manage')) or
    (bucket_id = 'question-images' and public.has_permission('questions.manage')))
  with check (
    (bucket_id = 'content' and public.has_permission('content.manage')) or
    (bucket_id = 'question-images' and public.has_permission('questions.manage')));

-- AI images are written by the Edge Function (service role) into <user_id>/...
drop policy if exists "ai images readable by owner" on storage.objects;
create policy "ai images readable by owner" on storage.objects for select to authenticated
  using (bucket_id = 'ai-images' and (storage.foldername(name))[1] = auth.uid()::text);

reset search_path;

-- >>>>>>>>>> 20261028001300_reference_data.sql
-- =====================================================================
-- 1300 REFERENCE DATA needed in every environment (idempotent upserts).
-- Prices, credits and limits are STARTING VALUES. Change them in the
-- admin dashboard (AI & Plans / Payments) rather than here.
-- =====================================================================

insert into public.programmes(code, name, description) values
  ('RN', 'Registered Nursing', 'General nursing pathway'),
  ('RM', 'Registered Midwifery', 'Midwifery pathway')
on conflict (code) do nothing;

-- Role -> permission matrix. '*' = all permissions.
insert into public.role_permissions(role, permission) values
  ('super_admin', '*'),
  ('content_admin', 'content.manage'), ('content_admin', 'content.review'), ('content_admin', 'reports.manage'),
  ('content_admin', 'users.view'),
  ('question_admin', 'questions.manage'), ('question_admin', 'reports.manage'),
  ('reviewer', 'content.review'), ('reviewer', 'questions.review'), ('reviewer', 'reports.manage'),
  ('exam_admin', 'exams.manage'), ('exam_admin', 'questions.manage'),
  ('support', 'users.view'), ('support', 'users.manage'), ('support', 'access.grant'),
  ('support', 'support.manage'), ('support', 'reports.manage'), ('support', 'notifications.send'),
  ('finance', 'payments.view'), ('finance', 'payments.manage'), ('finance', 'pricing.manage'), ('finance', 'users.view')
on conflict do nothing;

-- Exam products (prices in kobo: ₦1,500 = 150000 kobo).
insert into public.products(code, name, description, price_kobo, access_days) values
  ('section_c', 'Section C — Mock Examination',
   'Timed Papers 1–3 objective practice plus Paper 4 viva/CAOSCE-style practice.', 150000, 365),
  ('section_d', 'Section D — Final Examination Simulator',
   'Separate full-length final-exam simulations with readiness tracking.', 500000, 365)
on conflict (code) do nothing;

-- AI plans: 1x / 4x / 16x / 64x credits. Paid prices are placeholders.
insert into public.ai_plans(code, name, monthly_credits, price_kobo, image_limit, web_search_limit, video_search_limit, position) values
  ('free',     'Free',       100,       0,  2,   5,  10, 0),
  ('standard', 'Standard',   400,  150000,  8,  20,  40, 1),
  ('pro',      'Pro',       1600,  400000, 30,  80, 160, 2),
  ('ultra',    'Ultra',     6400, 1000000, 120, 320, 640, 3)
on conflict (code) do nothing;

-- Different operations cost different credits.
insert into public.ai_action_costs(action, label, credits, tier, max_output_tokens, est_provider_cost_usd, description) values
  ('explain_simple',     'Explain simply',            1, 'fast',          700, 0.002, 'Plain-language explanation of the selection'),
  ('explain_exam',       'Explain at exam level',     2, 'strong',       1000, 0.012, 'Nursing/midwifery examination-level explanation'),
  ('summarize',          'Summarise',                 1, 'fast',          600, 0.002, 'Concise revision summary'),
  ('expand_notes',       'Expand into detailed notes',4, 'strong',       2000, 0.030, 'Detailed study notes grounded in the library'),
  ('differentiate',      'Differentiate concepts',    3, 'strong',       1400, 0.020, 'Side-by-side comparison table'),
  ('flashcards',         'Make flashcards',           3, 'fast',         1400, 0.004, 'Question/answer cards saved to your deck'),
  ('mnemonic',           'Create a mnemonic',         1, 'fast',          400, 0.001, 'Memory aid for a list or sequence'),
  ('practice_questions', 'Generate practice questions',5,'strong',       2200, 0.035, 'Unverified AI practice MCQs with rationales'),
  ('follow_up',          'Ask a follow-up question',  1, 'fast',          800, 0.003, 'Question about the selected content'),
  ('rationale_expand',   'Expand the rationale',      2, 'strong',       1000, 0.012, 'Deeper explanation of an answered question'),
  ('viva_feedback',      'Viva/CAOSCE feedback',      4, 'strong',       1500, 0.025, 'Practice feedback against the station rubric'),
  ('diagram',            'Create a diagram',         20, 'image',          50, 0.060, 'Educational illustration'),
  ('web_search',         'Search trusted sources',    5, 'web_search',   1200, 0.030, 'Web search with citations'),
  ('video_search',       'Find videos',               2, 'video_search',   50, 0.000, 'Relevant educational YouTube videos')
on conflict (action) do nothing;

insert into public.app_settings(key, value, description) values
  ('ai.config', jsonb_build_object(
      'enabled', true,
      'text_provider', 'anthropic',
      'fast_model', 'claude-haiku-5-5',
      'strong_model', 'claude-sonnet-5-5',
      'fallback_provider', 'openai',
      'fallback_fast_model', '',
      'fallback_strong_model', '',
      'image_provider', 'openai',
      'image_model', 'gpt-image-1',
      'image_size', '1024x1024',
      'daily_budget_usd', 20,
      'per_user_per_minute', 10,
      'max_input_chars', 12000,
      'timeout_ms', 45000,
      'pricing', '{}'::jsonb),
   'AI provider/model selection and budget controls. API keys are NOT stored here (Edge Function secrets).'),
  ('payments.config', jsonb_build_object('provider', 'paystack', 'mode', 'test', 'callback_path', '/payment/callback'),
   'Payment provider mode. Keys live in Edge Function secrets.')
on conflict (key) do nothing;

insert into public.feature_flags(key, enabled, description) values
  ('ai_assistant', true,  'AI study assistant across the app'),
  ('ai_images',    true,  'AI diagram generation'),
  ('video_search', true,  'YouTube educational video search'),
  ('web_search',   false, 'AI web search with citations (enable after testing)'),
  ('section_c',    true,  'Section C mock examination'),
  ('section_d',    true,  'Section D final examination simulator'),
  ('maintenance_banner', false, 'Show a maintenance banner to students')
on conflict (key) do nothing;

reset search_path;

-- >>>>>>>>>> 20261028001400_ai_retrieval.sql
-- =====================================================================
-- 1400 RETRIEVAL FOR THE AI SERVICE (service role only)
-- Returns approved, published study material relevant to a request so the
-- AI is grounded in the library and can cite it.
-- =====================================================================

create or replace function public.ai_retrieve_notes(p_query text, p_note uuid default null, p_topic uuid default null, p_limit int default 3)
returns table(note_id uuid, title text, topic text, excerpt text, rank real)
language plpgsql stable security definer set search_path = public as $$
declare q tsquery;
begin
  -- 1) The note the student is reading always comes first.
  if p_note is not null then
    return query
    select n.id, n.title, t.title, left(v.body_md, 6000), 10::real
      from public.notes n join public.note_versions v on v.id = n.current_version_id
      join public.topics t on t.id = n.topic_id
     where n.id = p_note and n.status = 'published';
  end if;

  -- 2) Best full-text matches among published notes (optionally same topic first).
  if coalesce(trim(p_query), '') <> '' then
    q := websearch_to_tsquery('english', left(p_query, 300));
    return query
    select n.id, n.title, t.title,
           ts_headline('english', v.body_md, q, 'MaxFragments=3, MaxWords=60, MinWords=20, FragmentDelimiter=" … "'),
           (ts_rank(v.search, q) + case when p_topic is not null and n.topic_id = p_topic then 0.5 else 0 end)::real
      from public.notes n join public.note_versions v on v.id = n.current_version_id
      join public.topics t on t.id = n.topic_id
     where n.status = 'published' and (p_note is null or n.id <> p_note)
       and (v.search @@ q or (p_topic is not null and n.topic_id = p_topic))
     order by 5 desc
     limit least(greatest(p_limit, 0), 5);
  end if;
end $$;

revoke execute on function public.ai_retrieve_notes(text, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.ai_retrieve_notes(text, uuid, uuid, int) to service_role;

-- Viva feedback stores its result through this narrow service-role function.
create or replace function public.station_store_ai_feedback(p_attempt uuid, p_user uuid, p_feedback text)
returns void language sql security definer set search_path = public as $$
  update public.station_attempts set ai_feedback = left(p_feedback, 8000) where id = p_attempt and user_id = p_user;
$$;
revoke execute on function public.station_store_ai_feedback(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.station_store_ai_feedback(uuid, uuid, text) to service_role;

reset search_path;

-- >>>>>>>>>> 20261028001500_publish_guards.sql
-- =====================================================================
-- 1500 PUBLISH GUARDS
-- Editors (content.manage / questions.manage) can write drafts directly,
-- but only reviewers can make content visible to students — even if an
-- editor bypasses the admin UI and calls the REST API directly.
-- Server-side code running without a user (service role / migrations)
-- is not restricted by these checks.
-- =====================================================================

create or replace function public.tg_require_review_to_publish()
returns trigger language plpgsql security definer set search_path = public as $$
declare perm text := tg_argv[0];
begin
  if auth.uid() is null then return new; end if;   -- trusted server context
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published')
     and not public.has_permission(perm) then
    raise exception 'permission_denied:%', perm using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['curriculum_versions','courses','modules','topics','notes'] loop
    execute format('drop trigger if exists require_review_%1$s on public.%1$I', t);
    execute format('create trigger require_review_%1$s before insert or update of status on public.%1$I
                    for each row execute function public.tg_require_review_to_publish(%2$L)', t, 'content.review');
  end loop;
end $$;

drop trigger if exists require_review_questions on public.questions;
create trigger require_review_questions before insert or update of status on public.questions
  for each row execute function public.tg_require_review_to_publish('questions.review');

-- A note's live version may only point at an APPROVED version of the same note,
-- and only a reviewer may switch it.
create or replace function public.tg_note_current_version_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_version_id is not distinct from old.current_version_id then return new; end if;
  if new.current_version_id is not null and not exists (
       select 1 from public.note_versions v
        where v.id = new.current_version_id and v.note_id = new.id and v.status = 'approved') then
    raise exception 'current_version_must_be_approved';
  end if;
  if auth.uid() is not null and not public.has_permission('content.review') then
    raise exception 'permission_denied:content.review' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists note_current_version_guard on public.notes;
create trigger note_current_version_guard before update of current_version_id on public.notes
  for each row execute function public.tg_note_current_version_guard();

-- Question edits must go through admin_save_question (versioned + validated).
revoke update on public.questions from anon, authenticated;
drop policy if exists q_admin_update on public.questions;

-- ---------------------------------------------------------------------
-- Extra foreign keys to profiles so the admin UI can embed the student's
-- name/email (PostgREST only embeds tables in the exposed schema).
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('payments', 'payments_user_profile_fk', 'restrict'),
    ('support_tickets', 'support_tickets_user_profile_fk', 'cascade'),
    ('content_reports', 'content_reports_user_profile_fk', 'cascade'),
    ('entitlements', 'entitlements_user_profile_fk', 'cascade')) as t(tbl, name, on_del)
  loop
    begin
      execute format('alter table public.%I add constraint %I foreign key (user_id) references public.profiles(id) on delete %s',
                     r.tbl, r.name, r.on_del);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

reset search_path;

-- >>>>>>>>>> 20261028001600_admin_extras.sql
-- =====================================================================
-- 1600 ADMIN EXTRAS
-- =====================================================================

-- Notify one student (e.g. "Support replied").
create or replace function public.admin_notify_user(p_user uuid, p_title text, p_body text default null, p_link text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('support.manage') or public.has_permission('notifications.send')) then
    raise exception 'permission_denied:support.manage' using errcode = '42501';
  end if;
  insert into public.notifications(user_id, title, body, link)
  values (p_user, left(p_title, 200), left(p_body, 2000), case when p_link like '/%' then p_link end);
end $$;
revoke execute on function public.admin_notify_user(uuid, text, text, text) from public, anon;
grant execute on function public.admin_notify_user(uuid, text, text, text) to authenticated;

-- Admin list of staff accounts (Settings → Roles).
create or replace function public.admin_staff()
returns table(user_id uuid, email text, full_name text, roles public.app_role[])
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_permission('users.view');
  return query
  select p.id, p.email, p.full_name, array_agg(ur.role order by ur.role)
    from public.user_roles ur join public.profiles p on p.id = ur.user_id
   group by p.id, p.email, p.full_name order by p.email;
end $$;
revoke execute on function public.admin_staff() from public, anon;
grant execute on function public.admin_staff() to authenticated;

reset search_path;

select 'NMCN Study database setup complete' as status;
