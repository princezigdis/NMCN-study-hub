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
