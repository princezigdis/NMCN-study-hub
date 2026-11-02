-- Track isolation (applied to production as "track_isolation_rls").
-- Students can only read content linked to their own programme (RN or RM); staff are unaffected.
alter table public.profiles add column if not exists track_locked boolean not null default false;
update public.profiles set track_locked = true where programme_id is not null;
create or replace function public.tg_set_track_locked() returns trigger language plpgsql as $$
begin new.track_locked := new.programme_id is not null; return new; end $$;
create or replace trigger profiles_track_locked before insert or update of programme_id on public.profiles
  for each row execute function public.tg_set_track_locked();
revoke execute on function public.tg_set_track_locked() from public, anon, authenticated;

create or replace function public.my_track_code() returns text language sql stable security definer set search_path = public as $$
  select pr.code from public.profiles p join public.programmes pr on pr.id = p.programme_id where p.id = auth.uid() $$;
create or replace function public.course_in_my_track(p_course uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from public.course_programmes cp join public.profiles p on p.programme_id = cp.programme_id
     where cp.course_id = p_course and p.id = auth.uid()) $$;
create or replace function public.topic_in_my_track(p_topic uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from public.topics t join public.modules m on m.id = t.module_id
     where t.id = p_topic and public.course_in_my_track(m.course_id)) $$;
grant execute on function public.my_track_code(), public.course_in_my_track(uuid), public.topic_in_my_track(uuid) to authenticated, anon;

create policy track_only on public.courses as restrictive for select using (public.course_in_my_track(id));
create policy track_only on public.modules as restrictive for select using (public.course_in_my_track(course_id));
create policy track_only on public.topics as restrictive for select using (public.course_in_my_track((select m.course_id from public.modules m where m.id = module_id)));
create policy track_only on public.notes as restrictive for select using (public.topic_in_my_track(topic_id));
create policy track_only on public.questions as restrictive for select using (
  public.is_staff() or exists (select 1 from public.question_programmes qp join public.profiles p on p.programme_id = qp.programme_id
                                where qp.question_id = questions.id and p.id = auth.uid()));

-- note_reader / search_notes / practice_start: original bodies renamed to _*_impl; wrappers force the student's own track.
-- (see the production migration for the wrapper definitions)
