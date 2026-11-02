-- =====================================================================
-- 0500 VIVA MARKING — synonym layer + pg_trgm search_path fix
-- Applied after 0400. Everyday and local wording ("womb", "fits", "afterbirth")
-- is mapped onto the clinical term so a student who means the right thing is
-- not penalised for using different English. pg_trgm lives in "extensions".
-- Also: lab_import_viva(blob) — bulk loader used for seeding and admin import.
--   CASE|category_slug|programme|title|intro|difficulty|free(0/1)
--   Q|prompt|marks|model_answer|explanation|unsafe;;unsafe
--   P|key point|accepted;;accepted|marks|critical(0/1)
-- =====================================================================

create or replace function public._lab_norm(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    lower(coalesce(t, '')), 'ae|oe', 'e', 'g'),
    'is(e|ed|es|ing|ation|ations)\y', 'iz\1', 'g'),
    'yse(s|d)?\y', 'yze\1', 'g'),
    '\y(womb|uterine)\y', 'uterus', 'g'),
    '\y(afterbirth|after birth)\y', 'placenta', 'g'),
    '[^a-z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

create or replace function public._lab_syn(t text)
returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(public._lab_norm(t),
    '\y(seizures?|fits?|convulsions)\y', 'convulsion', 'g'),
    '\y(delivery|childbirth|deliver)\y', 'birth', 'g'),
    '\ylabour\y', 'labor', 'g'),
    '\ysweaty\y', 'sweating', 'g');
$$;

create or replace function public._lab_tokens(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct s), '{}') from (
    select case
      when length(w) > 5 and w ~ 'ations?$' then regexp_replace(w, 'ations?$', '')
      when length(w) > 5 and w ~ 'ing$' then regexp_replace(w, 'ing$', '')
      when length(w) > 4 and w ~ 'ies$' then regexp_replace(w, 'ies$', 'y')
      when length(w) > 4 and w ~ 'es$' then regexp_replace(w, 'es$', '')
      when length(w) > 4 and w ~ 'ed$' then regexp_replace(w, 'ed$', '')
      when length(w) > 3 and w ~ 's$' and w !~ 'ss$' then regexp_replace(w, 's$', '')
      else w end as s
    from unnest(string_to_array(public._lab_syn(t), ' ')) w
    where w <> '' and w <> all (array['a','an','the','of','to','in','on','at','and','or','is','are','be','by','for','with','from',
      'that','this','it','as','will','would','can','should','may','i','you','my','her','his','she','he','they','their','we','our',
      'when','if','then','also','so','do','does','did','have','has','had','been','was','were'])
  ) x where length(s) >= 2;
$$;

create or replace function public._lab_cover(p_ans text[], p_phrase text)
returns numeric language plpgsql stable set search_path = public, extensions as $$
declare pt text[] := public._lab_tokens(p_phrase); n int := coalesce(array_length(pt, 1), 0); m int := 0; w text; a text;
begin
  if n = 0 then return 0; end if;
  foreach w in array pt loop
    if w = any(p_ans) then m := m + 1;
    elsif length(w) >= 5 then
      foreach a in array p_ans loop
        if length(a) >= 5 and (extensions.similarity(a, w) >= 0.6 or (left(a, 5) = left(w, 5) and abs(length(a) - length(w)) <= 3)) then
          m := m + 1; exit;
        end if;
      end loop;
    end if;
  end loop;
  return m::numeric / n;
end $$;

create or replace function public.lab_import_viva(p_blob text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l text; parts text[]; cat uuid; cs uuid; q uuid; nc int := 0; nq int := 0; np int := 0; pos int := 0; ppos int := 0;
begin
  if auth.uid() is not null and not public.lab_staff() then raise exception 'forbidden'; end if;
  for l in select x from regexp_split_to_table(p_blob, E'\n') x where btrim(x) <> '' loop
    parts := string_to_array(l, '|');
    if parts[1] = 'CASE' then
      select id into cat from public.viva_categories where slug = parts[2];
      if cat is null then raise exception 'unknown_category %', parts[2]; end if;
      q := null; pos := 0;
      if exists (select 1 from public.viva_cases where category_id = cat and title = parts[4]) then cs := null;
      else
        insert into public.viva_cases(category_id, programme, title, intro, difficulty, is_free_preview, source_reference)
        values (cat, parts[3], parts[4], nullif(parts[5], ''), coalesce(nullif(parts[6], ''), 'medium'), parts[7] = '1', 'Draft - requires tutor review')
        returning id into cs; nc := nc + 1;
      end if;
    elsif parts[1] = 'Q' and cs is not null then
      pos := pos + 1; ppos := 0;
      insert into public.viva_questions(case_id, position, prompt, marks, model_answer, explanation, unsafe_phrases)
      values (cs, pos, parts[2], parts[3]::numeric, parts[4], nullif(parts[5], ''), coalesce(string_to_array(parts[6], ';;'), '{}'))
      returning id into q; nq := nq + 1;
    elsif parts[1] = 'P' and q is not null then
      ppos := ppos + 1;
      insert into public.viva_key_points(question_id, position, point, accepted, marks, is_critical)
      values (q, ppos, parts[2], coalesce(string_to_array(parts[3], ';;'), '{}'), parts[4]::numeric, parts[5] = '1'); np := np + 1;
    end if;
  end loop;
  return jsonb_build_object('cases', nc, 'questions', nq, 'points', np);
end $$;
revoke all on function public.lab_import_viva(text) from public, anon;
grant execute on function public.lab_import_viva(text) to authenticated;
