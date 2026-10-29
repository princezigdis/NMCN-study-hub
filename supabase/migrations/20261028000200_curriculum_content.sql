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
