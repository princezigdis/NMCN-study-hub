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
