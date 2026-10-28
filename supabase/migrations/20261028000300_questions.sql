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
