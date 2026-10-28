-- =====================================================================
-- 1100 ROW LEVEL SECURITY, COLUMN GRANTS, FUNCTION PRIVILEGES
-- Principle: students read published content + their own rows; all
-- score/credit/payment/role changes go through checked RPCs.
-- =====================================================================

-- ---------- Enable RLS on every table in public -----------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------- Explicit API grants ---------------------------------------
-- Works whether or not "Automatically expose new tables" is enabled in the
-- Supabase dashboard (recommended: disabled). RLS policies below decide which
-- ROWS each role sees; the revokes further down remove privileges students
-- must never have. Nothing is granted to anon here (see end of file).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Helper to keep policy creation idempotent.
create or replace function public._policy(p_table text, p_name text, p_sql text)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute p_sql;
end $$;

-- ---------- Reference data readable by everyone ----------------------
select public._policy('programmes', 'programmes_read', $p$create policy programmes_read on public.programmes for select using (true)$p$);
select public._policy('programmes', 'programmes_admin', $p$create policy programmes_admin on public.programmes for all
  using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$p$);

select public._policy('products', 'products_read', $p$create policy products_read on public.products for select using (active or public.has_permission('pricing.manage'))$p$);
select public._policy('products', 'products_admin', $p$create policy products_admin on public.products for all
  using (public.has_permission('pricing.manage')) with check (public.has_permission('pricing.manage'))$p$);

select public._policy('ai_plans', 'ai_plans_read', $p$create policy ai_plans_read on public.ai_plans for select using (active or public.has_permission('pricing.manage'))$p$);
select public._policy('ai_plans', 'ai_plans_admin', $p$create policy ai_plans_admin on public.ai_plans for all
  using (public.has_permission('pricing.manage') or public.has_permission('ai.manage'))
  with check (public.has_permission('pricing.manage') or public.has_permission('ai.manage'))$p$);

select public._policy('ai_action_costs', 'ai_costs_read', $p$create policy ai_costs_read on public.ai_action_costs for select using (true)$p$);
select public._policy('ai_action_costs', 'ai_costs_admin', $p$create policy ai_costs_admin on public.ai_action_costs for all
  using (public.has_permission('ai.manage')) with check (public.has_permission('ai.manage'))$p$);

select public._policy('feature_flags', 'flags_read', $p$create policy flags_read on public.feature_flags for select using (true)$p$);
select public._policy('feature_flags', 'flags_admin', $p$create policy flags_admin on public.feature_flags for all
  using (public.has_permission('settings.manage')) with check (public.has_permission('settings.manage'))$p$);

select public._policy('app_settings', 'settings_admin', $p$create policy settings_admin on public.app_settings for all
  using (public.has_permission('settings.manage') or (key like 'ai.%' and public.has_permission('ai.manage')))
  with check (public.has_permission('settings.manage') or (key like 'ai.%' and public.has_permission('ai.manage')))$p$);

select public._policy('role_permissions', 'role_perms_read', $p$create policy role_perms_read on public.role_permissions for select to authenticated using (true)$p$);

-- ---------- Profiles & roles ----------------------------------------
select public._policy('profiles', 'profiles_self_read', $p$create policy profiles_self_read on public.profiles for select
  using (id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('profiles', 'profiles_self_update', $p$create policy profiles_self_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid())$p$);

-- Students may only edit these profile columns (status/email are server-managed).
revoke update on public.profiles from anon, authenticated;
grant update (full_name, phone, programme_id, curriculum_version_id, institution, exam_target_date, onboarded)
  on public.profiles to authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

select public._policy('user_roles', 'roles_read', $p$create policy roles_read on public.user_roles for select
  using (user_id = auth.uid() or public.has_permission('roles.manage') or public.has_permission('users.view'))$p$);
revoke insert, update, delete on public.user_roles from anon, authenticated;

-- ---------- Curriculum & library content ------------------------------
do $$
declare t text;
begin
  foreach t in array array['curriculum_versions','courses','modules','topics','notes'] loop
    perform public._policy(t, t || '_read', format($f$create policy %I on public.%I for select
      using (status = 'published' or public.has_permission('content.manage') or public.has_permission('content.review'))$f$, t || '_read', t));
    perform public._policy(t, t || '_write', format($f$create policy %I on public.%I for insert
      with check (public.has_permission('content.manage'))$f$, t || '_write', t));
    perform public._policy(t, t || '_update', format($f$create policy %I on public.%I for update
      using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$f$, t || '_update', t));
    -- Only never-published drafts can be hard-deleted; everything else is archived.
    perform public._policy(t, t || '_delete', format($f$create policy %I on public.%I for delete
      using (public.has_permission('content.manage') and status = 'draft')$f$, t || '_delete', t));
  end loop;
end $$;

select public._policy('course_programmes', 'cp_read', $p$create policy cp_read on public.course_programmes for select using (true)$p$);
select public._policy('course_programmes', 'cp_admin', $p$create policy cp_admin on public.course_programmes for all
  using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$p$);

-- Students see only the version currently published for a published note.
select public._policy('note_versions', 'nv_read', $p$create policy nv_read on public.note_versions for select using (
  public.has_permission('content.manage') or public.has_permission('content.review')
  or exists (select 1 from public.notes n where n.current_version_id = note_versions.id and n.status = 'published'))$p$);
select public._policy('note_versions', 'nv_insert', $p$create policy nv_insert on public.note_versions for insert
  with check (public.has_permission('content.manage') and status in ('draft','in_review'))$p$);
-- Editors may change drafts; approval happens only through admin_review_note_version().
select public._policy('note_versions', 'nv_update', $p$create policy nv_update on public.note_versions for update
  using (public.has_permission('content.manage') and status in ('draft','rejected'))
  with check (status in ('draft','rejected','in_review'))$p$);

do $$
declare t text;
begin
  foreach t in array array['note_attachments','note_references'] loop
    perform public._policy(t, t || '_read', format($f$create policy %I on public.%I for select using (
      public.has_permission('content.manage') or exists (select 1 from public.notes n where n.id = %I.note_id and n.status = 'published'))$f$,
      t || '_read', t, t));
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('content.manage')) with check (public.has_permission('content.manage'))$f$, t || '_admin', t));
  end loop;
end $$;

-- ---------- Questions -------------------------------------------------
-- Students may read published PRACTICE question stems (e.g. saved list).
-- Exam-bank questions are never directly readable by students.
select public._policy('questions', 'q_read', $p$create policy q_read on public.questions for select using (
  (bank = 'practice' and status = 'published')
  or public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
select public._policy('questions', 'q_admin_update', $p$create policy q_admin_update on public.questions for update
  using (public.has_permission('questions.manage')) with check (public.has_permission('questions.manage'))$p$);
select public._policy('questions', 'q_admin_delete', $p$create policy q_admin_delete on public.questions for delete
  using (public.has_permission('questions.manage') and status = 'draft')$p$);
-- Inserts go through admin_save_question / admin_import_questions.
revoke insert on public.questions from anon, authenticated;

-- Answer keys & rationales: staff only. Students get them via RPC after answering.
select public._policy('question_options', 'qo_staff', $p$create policy qo_staff on public.question_options for select
  using (public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
revoke insert, update, delete on public.question_options from anon, authenticated;

select public._policy('question_programmes', 'qp_read', $p$create policy qp_read on public.question_programmes for select using (true)$p$);
revoke insert, update, delete on public.question_programmes from anon, authenticated;

select public._policy('question_versions', 'qv_staff', $p$create policy qv_staff on public.question_versions for select
  using (public.has_permission('questions.manage') or public.has_permission('questions.review'))$p$);
revoke insert, update, delete on public.question_versions from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['question_pools','question_pool_items'] loop
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('questions.manage') or public.has_permission('exams.manage'))
      with check (public.has_permission('questions.manage') or public.has_permission('exams.manage'))$f$, t || '_admin', t));
  end loop;
end $$;

-- ---------- Practice & exams (read own, write via RPC) ----------------
select public._policy('practice_sessions', 'ps_own', $p$create policy ps_own on public.practice_sessions for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('practice_items', 'pi_own', $p$create policy pi_own on public.practice_items for select
  using (exists (select 1 from public.practice_sessions s where s.id = session_id and s.user_id = auth.uid()))$p$);
select public._policy('exam_attempts', 'ea_own', $p$create policy ea_own on public.exam_attempts for select
  using (user_id = auth.uid() or public.has_permission('exams.manage') or public.has_permission('users.view'))$p$);
-- exam_attempt_items: no direct access at all (served by exam_get).
select public._policy('exam_attempt_items', 'eai_staff', $p$create policy eai_staff on public.exam_attempt_items for select
  using (public.has_permission('exams.manage'))$p$);
revoke insert, update, delete on public.practice_sessions, public.practice_items,
  public.exam_attempts, public.exam_attempt_items from anon, authenticated;

select public._policy('exam_configs', 'ec_read', $p$create policy ec_read on public.exam_configs for select
  using (status = 'published' or public.has_permission('exams.manage'))$p$);
select public._policy('exam_configs', 'ec_admin', $p$create policy ec_admin on public.exam_configs for all
  using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$p$);
select public._policy('exam_papers', 'ep_read', $p$create policy ep_read on public.exam_papers for select using (
  public.has_permission('exams.manage') or exists (select 1 from public.exam_configs c where c.id = config_id and c.status = 'published'))$p$);
select public._policy('exam_papers', 'ep_admin', $p$create policy ep_admin on public.exam_papers for all
  using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$p$);

-- Stations: rubric tables are staff-only; students use station_get/station_submit.
do $$
declare t text;
begin
  foreach t in array array['clinical_stations','station_checklist_items','station_viva_questions','exam_paper_stations'] loop
    perform public._policy(t, t || '_admin', format($f$create policy %I on public.%I for all
      using (public.has_permission('exams.manage')) with check (public.has_permission('exams.manage'))$f$, t || '_admin', t));
  end loop;
end $$;
select public._policy('station_attempts', 'sa_own', $p$create policy sa_own on public.station_attempts for select
  using (user_id = auth.uid() or public.has_permission('exams.manage'))$p$);
revoke insert, update, delete on public.station_attempts from anon, authenticated;

-- ---------- Personal learning data (full CRUD on own rows) ------------
do $$
declare t text;
begin
  foreach t in array array['bookmarks','highlights','personal_notes','flashcards','study_goals','timetable_entries'] loop
    perform public._policy(t, t || '_own', format($f$create policy %I on public.%I for all
      using (user_id = auth.uid() and public.is_active_user())
      with check (user_id = auth.uid() and public.is_active_user())$f$, t || '_own', t));
  end loop;
end $$;

select public._policy('reading_progress', 'rp_own', $p$create policy rp_own on public.reading_progress for select using (user_id = auth.uid())$p$);
revoke insert, update, delete on public.reading_progress from anon, authenticated;

select public._policy('study_activity', 'sact_own_read', $p$create policy sact_own_read on public.study_activity for select using (user_id = auth.uid())$p$);
-- Clients may log study minutes / flashcard reviews for themselves only.
select public._policy('study_activity', 'sact_own_insert', $p$create policy sact_own_insert on public.study_activity for insert
  with check (user_id = auth.uid() and kind in ('study_minutes','flashcard_reviewed') and public.is_active_user())$p$);
revoke update, delete on public.study_activity from anon, authenticated;

select public._policy('notifications', 'notif_own', $p$create policy notif_own on public.notifications for select using (user_id = auth.uid())$p$);
select public._policy('notifications', 'notif_mark_read', $p$create policy notif_mark_read on public.notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid())$p$);
revoke insert, delete on public.notifications from anon, authenticated;
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ---------- AI & credits (read own; writes via service-role RPCs) -----
select public._policy('credit_wallets', 'wallet_own', $p$create policy wallet_own on public.credit_wallets for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('credit_ledger', 'ledger_own', $p$create policy ledger_own on public.credit_ledger for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('ai_requests', 'aireq_own', $p$create policy aireq_own on public.ai_requests for select
  using (user_id = auth.uid() or public.has_permission('ai.manage'))$p$);
select public._policy('ai_subscriptions', 'aisub_own', $p$create policy aisub_own on public.ai_subscriptions for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
revoke insert, update, delete on public.credit_wallets, public.credit_ledger, public.ai_requests,
  public.ai_subscriptions from anon, authenticated;

-- ---------- Payments & access ----------------------------------------
select public._policy('payments', 'pay_own', $p$create policy pay_own on public.payments for select
  using (user_id = auth.uid() or public.has_permission('payments.view'))$p$);
select public._policy('entitlements', 'ent_own', $p$create policy ent_own on public.entitlements for select
  using (user_id = auth.uid() or public.has_permission('users.view'))$p$);
select public._policy('payment_events', 'pev_staff', $p$create policy pev_staff on public.payment_events for select
  using (public.has_permission('payments.view'))$p$);
select public._policy('refunds', 'refunds_staff', $p$create policy refunds_staff on public.refunds for select
  using (public.has_permission('payments.view'))$p$);
revoke insert, update, delete on public.payments, public.entitlements, public.payment_events, public.refunds
  from anon, authenticated;

-- ---------- Audit, reports, tickets ----------------------------------
select public._policy('audit_logs', 'audit_read', $p$create policy audit_read on public.audit_logs for select
  using (public.has_permission('audit.view'))$p$);
revoke insert, update, delete on public.audit_logs from anon, authenticated;

select public._policy('content_reports', 'cr_read', $p$create policy cr_read on public.content_reports for select
  using (user_id = auth.uid() or public.has_permission('reports.manage'))$p$);
select public._policy('content_reports', 'cr_insert', $p$create policy cr_insert on public.content_reports for insert
  with check (user_id = auth.uid() and status = 'open' and public.is_active_user())$p$);
select public._policy('content_reports', 'cr_admin', $p$create policy cr_admin on public.content_reports for update
  using (public.has_permission('reports.manage')) with check (public.has_permission('reports.manage'))$p$);

select public._policy('support_tickets', 'st_read', $p$create policy st_read on public.support_tickets for select
  using (user_id = auth.uid() or public.has_permission('support.manage'))$p$);
select public._policy('support_tickets', 'st_insert', $p$create policy st_insert on public.support_tickets for insert
  with check (user_id = auth.uid() and status = 'open' and admin_reply is null and public.is_active_user())$p$);
select public._policy('support_tickets', 'st_admin', $p$create policy st_admin on public.support_tickets for update
  using (public.has_permission('support.manage')) with check (public.has_permission('support.manage'))$p$);

-- Anonymous visitors get nothing beyond the public reference tables above.
revoke all on all tables in schema public from anon;
grant select on public.programmes, public.products, public.ai_plans, public.ai_action_costs, public.feature_flags to anon;

drop function public._policy(text, text, text);

-- ---------- Function privileges -------------------------------------
-- Supabase grants EXECUTE on new functions to anon/authenticated by
-- default. Lock everything down, then re-grant the public API.
revoke execute on all functions in schema public from public, anon, authenticated;

-- Helpers used inside RLS policies must stay callable.
grant execute on function public.is_active_user(), public.has_permission(text), public.is_staff(),
  public.has_entitlement(text) to authenticated;

-- Student API
grant execute on function
  public.touch_last_active(),
  public.note_reader(uuid, uuid), public.note_progress(uuid, int), public.search_notes(text, text, int),
  public.practice_start(int, text, uuid, uuid, public.difficulty_level, text), public.practice_get(uuid),
  public.practice_answer(uuid, int, uuid), public.practice_finish(uuid),
  public.exam_catalogue(text), public.exam_start(uuid), public.exam_get(uuid),
  public.exam_save_answer(uuid, int, uuid, boolean), public.exam_submit(uuid), public.exam_result(uuid),
  public.paper_stations(uuid), public.station_get(uuid), public.station_submit(uuid, jsonb),
  public.station_self_assess(uuid, uuid[], jsonb),
  public.my_topic_stats(), public.my_dashboard(), public.my_wallet()
to authenticated;

-- Admin API (each function re-checks permissions internally)
grant execute on function
  public.admin_overview(), public.admin_reorder(text, uuid[]),
  public.admin_submit_note_version(uuid), public.admin_review_note_version(uuid, boolean, text, date),
  public.admin_restore_note_version(uuid), public.admin_set_content_status(text, uuid, public.publication_status),
  public.admin_save_question(jsonb), public.admin_set_question_status(uuid[], public.publication_status),
  public.admin_similar_questions(text, public.question_bank, uuid),
  public.admin_import_questions(jsonb, public.publication_status, boolean, boolean),
  public.admin_user_detail(uuid), public.admin_set_user_status(uuid, public.account_status, text),
  public.admin_set_programme(uuid, text), public.admin_set_role(uuid, public.app_role, boolean),
  public.admin_grant_entitlement(uuid, text, int, text), public.admin_revoke_entitlement(uuid, text),
  public.admin_extend_entitlement(uuid, int), public.admin_grant_plan(uuid, text, int, text),
  public.admin_adjust_credits(uuid, int, text), public.admin_record_refund(uuid, text, int),
  public.admin_broadcast(text, text, text, text), public.admin_ai_usage(int),
  public.question_problems(uuid)
to authenticated;

-- Trusted server only (Edge Functions with the service-role key).
grant execute on function
  public.ai_reserve(uuid, text, text, jsonb),
  public.ai_complete(uuid, boolean, text, text, int, int, numeric, int, text, text),
  public.payment_fulfill(text, int, text, text, text, timestamptz, jsonb),
  public.payment_mark(text, text, jsonb),
  public.user_has_entitlement(uuid, text)
to service_role;
