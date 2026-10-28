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
