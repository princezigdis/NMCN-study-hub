-- =====================================================================
-- Minimal stand-in for the parts of Supabase that the migrations use,
-- so the schema + RLS tests can run against a plain throwaway Postgres.
-- NEVER run this against a real Supabase project (it already has these).
-- =====================================================================
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

-- Supabase's default privileges: API roles can use public objects (RLS decides rows).
grant usage on schema public to anon, authenticated, service_role;
-- Mirrors the dashboard option "Automatically expose new tables". The runner
-- sets :expose to off to prove the migrations work with it disabled.
\if :{?expose}
\else
  \set expose on
\endif
select (:'expose' = 'on') as expose_tables \gset
\if :expose_tables
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
\endif
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
