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
