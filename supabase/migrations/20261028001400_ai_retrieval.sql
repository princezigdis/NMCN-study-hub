-- =====================================================================
-- 1400 RETRIEVAL FOR THE AI SERVICE (service role only)
-- Returns approved, published study material relevant to a request so the
-- AI is grounded in the library and can cite it.
-- =====================================================================

create or replace function public.ai_retrieve_notes(p_query text, p_note uuid default null, p_topic uuid default null, p_limit int default 3)
returns table(note_id uuid, title text, topic text, excerpt text, rank real)
language plpgsql stable security definer set search_path = public as $$
declare q tsquery;
begin
  -- 1) The note the student is reading always comes first.
  if p_note is not null then
    return query
    select n.id, n.title, t.title, left(v.body_md, 6000), 10::real
      from public.notes n join public.note_versions v on v.id = n.current_version_id
      join public.topics t on t.id = n.topic_id
     where n.id = p_note and n.status = 'published';
  end if;

  -- 2) Best full-text matches among published notes (optionally same topic first).
  if coalesce(trim(p_query), '') <> '' then
    q := websearch_to_tsquery('english', left(p_query, 300));
    return query
    select n.id, n.title, t.title,
           ts_headline('english', v.body_md, q, 'MaxFragments=3, MaxWords=60, MinWords=20, FragmentDelimiter=" … "'),
           (ts_rank(v.search, q) + case when p_topic is not null and n.topic_id = p_topic then 0.5 else 0 end)::real
      from public.notes n join public.note_versions v on v.id = n.current_version_id
      join public.topics t on t.id = n.topic_id
     where n.status = 'published' and (p_note is null or n.id <> p_note)
       and (v.search @@ q or (p_topic is not null and n.topic_id = p_topic))
     order by 5 desc
     limit least(greatest(p_limit, 0), 5);
  end if;
end $$;

revoke execute on function public.ai_retrieve_notes(text, uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.ai_retrieve_notes(text, uuid, uuid, int) to service_role;

-- Viva feedback stores its result through this narrow service-role function.
create or replace function public.station_store_ai_feedback(p_attempt uuid, p_user uuid, p_feedback text)
returns void language sql security definer set search_path = public as $$
  update public.station_attempts set ai_feedback = left(p_feedback, 8000) where id = p_attempt and user_id = p_user;
$$;
revoke execute on function public.station_store_ai_feedback(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.station_store_ai_feedback(uuid, uuid, text) to service_role;
