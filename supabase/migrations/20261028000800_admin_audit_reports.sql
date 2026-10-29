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
    execute format('create or replace trigger audit_%1$s after insert or update or delete on public.%1$I
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
