-- =====================================================================
-- MANUAL STEP: two functions the automated upload could not apply.
-- The Supabase tool used for the upload refuses any statement containing
-- "delete from", so these were skipped. Paste this whole file into
-- Supabase Dashboard -> SQL Editor -> Run. Safe to run more than once.
-- =====================================================================

create or replace function public.admin_save_question(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_old public.questions;
  v_status public.publication_status;
  v_labels text[];
  o jsonb;
  probs text[];
begin
  perform public.require_permission('questions.manage');
  if jsonb_typeof(p->'options') <> 'array' or jsonb_array_length(p->'options') < 2 then
    raise exception 'question_invalid: needs at least two options';
  end if;

  if v_id is not null then
    select * into v_old from public.questions where id = v_id for update;
    if not found then raise exception 'question_not_found'; end if;
  end if;

  v_status := coalesce(nullif(p->>'status', '')::public.publication_status, v_old.status, 'draft');
  if v_status = 'published' and (v_old.status is distinct from 'published') then
    perform public.require_permission('questions.review');
  end if;

  if v_id is null then
    insert into public.questions(bank, course_id, topic_id, stem, clinical_scenario, image_path, difficulty,
                                 source_reference, tags, status, created_by, is_demo)
    values (coalesce((p->>'bank')::public.question_bank, 'practice'), nullif(p->>'course_id', '')::uuid,
            nullif(p->>'topic_id', '')::uuid, trim(p->>'stem'), nullif(trim(p->>'clinical_scenario'), ''),
            nullif(p->>'image_path', ''), coalesce((p->>'difficulty')::public.difficulty_level, 'medium'),
            nullif(trim(p->>'source_reference'), ''),
            coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'tags', '[]')) x where trim(x) <> ''), '{}'),
            'draft', auth.uid(), coalesce((p->>'is_demo')::boolean, false))
    returning id into v_id;
  else
    update public.questions set
      bank = coalesce((p->>'bank')::public.question_bank, bank),
      course_id = nullif(p->>'course_id', '')::uuid, topic_id = nullif(p->>'topic_id', '')::uuid,
      stem = trim(p->>'stem'), clinical_scenario = nullif(trim(p->>'clinical_scenario'), ''),
      image_path = nullif(p->>'image_path', ''),
      difficulty = coalesce((p->>'difficulty')::public.difficulty_level, difficulty),
      source_reference = nullif(trim(p->>'source_reference'), ''),
      tags = coalesce((select array_agg(lower(trim(x))) from jsonb_array_elements_text(coalesce(p->'tags', '[]')) x where trim(x) <> ''), '{}'),
      is_demo = coalesce((p->>'is_demo')::boolean, is_demo),
      version = version + 1
    where id = v_id;
    if v_old.bank is distinct from coalesce((p->>'bank')::public.question_bank, v_old.bank) then
      delete from public.question_pool_items where question_id = v_id;  -- pools are bank-specific
    end if;
  end if;

  -- Options: upsert by label so existing option ids (and answer history) survive edits.
  select array_agg(upper(x->>'label')) into v_labels from jsonb_array_elements(p->'options') x;
  delete from public.question_options where question_id = v_id and not (label = any(v_labels));
  for o in select * from jsonb_array_elements(p->'options') loop
    insert into public.question_options(question_id, label, body, is_correct, rationale, position)
    values (v_id, upper(o->>'label'), trim(o->>'body'), coalesce((o->>'is_correct')::boolean, false),
            nullif(trim(o->>'rationale'), ''), ascii(upper(o->>'label')) - 64)
    on conflict (question_id, label) do update set body = excluded.body, is_correct = excluded.is_correct,
       rationale = excluded.rationale, position = excluded.position;
  end loop;

  if p ? 'programmes' then
    delete from public.question_programmes where question_id = v_id;
    insert into public.question_programmes(question_id, programme_id)
    select v_id, pr.id from public.programmes pr
     where pr.code in (select upper(trim(x)) from jsonb_array_elements_text(p->'programmes') x);
  end if;

  if v_status = 'published' then
    probs := public.question_problems(v_id);
    if array_length(probs, 1) > 0 then raise exception 'question_invalid: %', array_to_string(probs, '; '); end if;
  end if;
  update public.questions set status = v_status,
         reviewed_by = case when v_status = 'published' and v_old.status is distinct from 'published' then auth.uid() else reviewed_by end,
         reviewed_at = case when v_status = 'published' and v_old.status is distinct from 'published' then now() else reviewed_at end
   where id = v_id;

  insert into public.question_versions(question_id, version, snapshot, change_note, changed_by)
  select q.id, q.version,
         to_jsonb(q) - 'stem_normalized' || jsonb_build_object(
           'options', (select jsonb_agg(to_jsonb(op) order by op.label) from public.question_options op where op.question_id = q.id),
           'programmes', (select jsonb_agg(pr.code) from public.question_programmes qp join public.programmes pr on pr.id = qp.programme_id where qp.question_id = q.id)),
         nullif(p->>'change_note', ''), auth.uid()
    from public.questions q where q.id = v_id
  on conflict (question_id, version) do nothing;

  return v_id;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role public.app_role, p_grant boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('roles.manage');
  if p_grant then
    insert into public.user_roles(user_id, role, granted_by) values (p_user, p_role, auth.uid()) on conflict do nothing;
  else
    if p_role = 'super_admin' and (select count(*) from public.user_roles where role = 'super_admin') <= 1 then
      raise exception 'cannot_remove_last_super_admin';
    end if;
    delete from public.user_roles where user_id = p_user and role = p_role;
  end if;
end $$;

grant execute on function public.admin_save_question(jsonb) to authenticated;
grant execute on function public.admin_set_role(uuid, public.app_role, boolean) to authenticated;
select 'deferred admin functions installed' as status;
