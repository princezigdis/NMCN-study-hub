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
