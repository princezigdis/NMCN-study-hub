-- AI credit ledger, payment fulfilment, admin content workflows.
begin;
set search_path = public, extensions;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'credits@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'boss@example.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'reviewer@example.test'),
  ('00000000-0000-0000-0000-0000000000f4', 'qadmin@example.test');
insert into public.user_roles(user_id, role) values
  ('00000000-0000-0000-0000-0000000000f2', 'super_admin'),
  ('00000000-0000-0000-0000-0000000000f3', 'reviewer'),
  ('00000000-0000-0000-0000-0000000000f4', 'question_admin');

-- ================= Credits (as the trusted server) =================
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000f1'; r jsonb; r2 jsonb; c jsonb;
begin
  r := public.ai_reserve(u, 'summarize', 'idem-key-0001', '{}');
  assert (r->>'ok')::boolean and (r->>'balance')::int = 99, 'free plan starts at 100; summarize costs 1';
  r2 := public.ai_reserve(u, 'summarize', 'idem-key-0001', '{}');
  assert (r2->>'duplicate')::boolean, 'same idempotency key is not charged twice';
  assert (select balance from public.credit_wallets where user_id = u) = 99, 'no double deduction';

  c := public.ai_complete((r->>'request_id')::uuid, false, 'anthropic', 'm', null, null, null, 100, 'provider_timeout', null);
  assert (c->>'status') = 'refunded' and (c->>'balance')::int = 100, 'failed request refunded';
  c := public.ai_complete((r->>'request_id')::uuid, false);
  assert (c->>'already_settled')::boolean, 'settlement is idempotent';
  assert (select balance from public.credit_wallets where user_id = u) = 100, 'no double refund';

  r := public.ai_reserve(u, 'expand_notes', 'idem-key-0002', '{}');
  perform public.ai_complete((r->>'request_id')::uuid, true, 'anthropic', 'm', 100, 200, 0.01, 500, null, 'ok');
  assert (select balance from public.credit_wallets where user_id = u) = 96, 'different actions cost different credits';
  assert (select count(*) from public.credit_ledger where user_id = u) >= 4, 'ledger records every movement';

  update public.credit_wallets set balance = 3 where user_id = u;
  r := public.ai_reserve(u, 'expand_notes', 'idem-key-0003', '{}');
  assert r->>'error' = 'insufficient_credits', 'cannot go negative';

  update public.credit_wallets set balance = 100, images_used = 2 where user_id = u;
  r := public.ai_reserve(u, 'diagram', 'idem-key-0004', '{}');
  assert r->>'error' = 'image_limit_reached', 'plan image quota enforced';

  update public.app_settings set value = value || '{"per_user_per_minute": 2}' where key = 'ai.config';
  r := public.ai_reserve(u, 'mnemonic', 'idem-key-0005', '{}');
  assert r->>'error' = 'rate_limited', 'per-minute rate limit enforced';
  update public.app_settings set value = value || '{"per_user_per_minute": 100, "daily_budget_usd": 0.001}' where key = 'ai.config';
  r := public.ai_reserve(u, 'mnemonic', 'idem-key-0006', '{}');
  assert r->>'error' = 'budget_exceeded', 'daily provider budget cap enforced';
  update public.app_settings set value = value || '{"daily_budget_usd": 20}' where key = 'ai.config';

  update public.ai_action_costs set enabled = false where action = 'mnemonic';
  r := public.ai_reserve(u, 'mnemonic', 'idem-key-0007', '{}');
  assert r->>'error' = 'action_disabled', 'disabled actions blocked';
  update public.ai_action_costs set enabled = true where action = 'mnemonic';

  -- Period rollover: expired period resets to plan allowance.
  update public.credit_wallets set period_end = now() - interval '1 second', balance = 7 where user_id = u;
  assert (public.ai_reserve(u, 'mnemonic', 'idem-key-0008', '{}')->>'balance')::int = 99, 'monthly reset grants 100 again';
end $$;

-- ================= Payments =================
insert into public.payments(user_id, reference, purpose, item_code, amount_kobo) values
  ('00000000-0000-0000-0000-0000000000f1', 'NMCN-TEST-REF-0001', 'product', 'section_d', 500000),
  ('00000000-0000-0000-0000-0000000000f1', 'NMCN-TEST-REF-0002', 'product', 'section_d', 500000),
  ('00000000-0000-0000-0000-0000000000f1', 'NMCN-TEST-REF-0003', 'ai_plan', 'standard', 150000);
do $$
declare u uuid := '00000000-0000-0000-0000-0000000000f1'; r jsonb; bal int;
begin
  r := public.payment_fulfill('NMCN-TEST-REF-0001', 100, 'NGN', 'tx1', 'card', now(), '{}');
  assert r->>'error' = 'amount_mismatch', 'tampered amount rejected';
  assert not public.user_has_entitlement(u, 'section_d'), 'no access after mismatch';

  r := public.payment_fulfill('NMCN-TEST-REF-0002', 500000, 'NGN', 'tx2', 'card', now(), '{}');
  assert (r->>'ok')::boolean, 'valid payment fulfilled';
  r := public.payment_fulfill('NMCN-TEST-REF-0002', 500000, 'NGN', 'tx2', 'card', now(), '{}');
  assert (r->>'already_processed')::boolean, 'duplicate webhook is a no-op';
  assert (select count(*) from public.entitlements where user_id = u and product_code = 'section_d') = 1, 'exactly one entitlement';
  assert public.user_has_entitlement(u, 'section_d') and not public.user_has_entitlement(u, 'section_c'), 'D does not grant C';

  bal := (select balance from public.credit_wallets where user_id = u);
  r := public.payment_fulfill('NMCN-TEST-REF-0003', 150000, 'NGN', 'tx3', 'card', now(), '{}');
  assert (select plan_code from public.credit_wallets where user_id = u) = 'standard', 'plan upgraded';
  assert (select balance from public.credit_wallets where user_id = u) = bal + 400, 'standard credits added';

  r := public.payment_fulfill('NMCN-UNKNOWN-0000', 1, 'NGN', null, null, null, '{}');
  assert r->>'error' = 'unknown_reference', 'unknown references ignored';
end $$;

-- Refund revokes access (finance permission via super admin).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
select public.admin_record_refund((select id from public.payments where reference = 'NMCN-TEST-REF-0002'), 'Customer request');
reset role;
do $$ begin
  assert not public.user_has_entitlement('00000000-0000-0000-0000-0000000000f1', 'section_d'), 'refund revokes access';
end $$;

-- ================= Question workflow =================
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f4', true);  -- question_admin
do $$
declare v_id uuid; ok boolean; r jsonb; topic uuid := (select id from public.topics where title = 'Vital Signs');
begin
  -- Invalid: two correct options
  v_id := public.admin_save_question(jsonb_build_object('topic_id', topic, 'stem', 'Bad question with two answers?',
    'programmes', '["RN"]'::jsonb, 'status', 'draft',
    'options', '[{"label":"A","body":"x","is_correct":true,"rationale":"r"},{"label":"B","body":"y","is_correct":true,"rationale":"r"}]'::jsonb));
  ok := false;
  begin
    perform public.admin_set_question_status(array[v_id], 'published');
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'question admin cannot publish (reviewer required)';

  v_id := public.admin_save_question(jsonb_build_object('topic_id', topic, 'stem', 'Which artery is used for a routine adult pulse check?',
      'programmes', '["RN","RM"]'::jsonb, 'difficulty', 'easy',
      'options', '[{"label":"A","body":"Radial","is_correct":true,"rationale":"Accessible and superficial."},
                   {"label":"B","body":"Femoral","is_correct":false,"rationale":"Used in emergencies."},
                   {"label":"C","body":"Popliteal","is_correct":false,"rationale":"Difficult to palpate."}]'::jsonb));
  assert (select status from public.questions where id = v_id) = 'draft', 'new questions start as drafts';
  assert (select count(*) from public.question_versions where question_id = v_id) = 1, 'version snapshot saved';

  -- Edit keeps option ids (history) and bumps version
  perform public.admin_save_question(jsonb_build_object('id', v_id, 'topic_id', topic,
      'stem', 'Which artery is most commonly used for a routine adult pulse check?', 'programmes', '["RN","RM"]'::jsonb,
      'options', '[{"label":"A","body":"Radial artery","is_correct":true,"rationale":"Accessible and superficial."},
                   {"label":"B","body":"Femoral","is_correct":false,"rationale":"Used in emergencies."},
                   {"label":"C","body":"Popliteal","is_correct":false,"rationale":"Difficult to palpate."}]'::jsonb));
  assert (select version from public.questions where id = v_id) = 2, 'version incremented';

  -- Import: 1 good, 1 duplicate of an existing practice question, 1 bad
  r := public.admin_import_questions(jsonb_build_array(
    jsonb_build_object('course_code', 'DEMO-FON', 'topic_title', 'Vital Signs', 'stem', 'Which device measures oxygen saturation non-invasively?',
      'option_a', 'Pulse oximeter', 'rationale_a', 'Correct', 'option_b', 'Sphygmomanometer', 'rationale_b', 'Measures BP',
      'option_c', 'Glucometer', 'rationale_c', 'Measures glucose', 'correct', 'A', 'programmes', 'RN,RM'),
    jsonb_build_object('topic_title', 'Vital Signs', 'stem', 'What is the normal resting respiratory rate for a healthy adult?',
      'option_a', 'x', 'option_b', 'y', 'correct', 'A'),
    jsonb_build_object('topic_title', 'No Such Topic', 'stem', 'Orphan question here?', 'option_a', 'x', 'option_b', 'y', 'correct', 'A')
  ), 'draft', true, false);
  assert jsonb_array_length(r->'inserted') = 1, 'good row imported';
  assert jsonb_array_length(r->'duplicates') = 1, 'duplicate detected';
  assert jsonb_array_length(r->'errors') = 1, 'bad row reported, not fatal';
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', true);  -- reviewer
do $$
declare r jsonb;
begin
  r := public.admin_set_question_status(array(select id from public.questions where stem like 'Which artery is most commonly%'
                                               or stem = 'Bad question with two answers?'), 'published');
  assert (r->>'updated')::int = 1, 'valid question published by reviewer';
  assert jsonb_array_length(r->'failed') = 1, 'invalid question refused with reasons';
end $$;
reset role;

-- Hard guard at the table level, even for the owner.
do $$
declare ok boolean := false; v uuid;
begin
  begin
    insert into public.questions(stem, status, topic_id) values ('Published without options?', 'published',
      (select id from public.topics limit 1)) returning id into v;
    set constraints question_publish_guard immediate;
  exception when others then ok := sqlerrm like 'question_invalid%'; end;
  assert ok, 'database refuses invalid published questions';
end $$;

-- Pools can't mix banks: a practice question in a Section D pool is refused.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.question_pool_items(pool_id, question_id)
    values ((select id from public.question_pools where bank = 'section_d' limit 1),
            (select id from public.questions where bank = 'practice' limit 1));
  exception when others then ok := sqlerrm like 'pool_bank_mismatch%'; end;
  assert ok, 'Section D pool cannot borrow practice/Section C questions';
end $$;

-- ================= Notes: draft -> review -> publish =================
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
do $$
declare n uuid; v uuid; v2 uuid; topic uuid := (select id from public.topics where title = 'Vital Signs');
begin
  insert into public.notes(topic_id, title) values (topic, 'Pain Assessment') returning id into n;
  insert into public.note_versions(note_id, version, body_md) values (n, 0, '## Pain scales') returning id into v;
  assert (select version from public.note_versions where id = v) = 1, 'versions auto-number';
  perform public.admin_submit_note_version(v);
  perform public.admin_review_note_version(v, true, 'Checked against guideline', current_date + 365);
  assert (select status from public.notes where id = n) = 'published', 'approved note is published';
  assert (public.note_reader(n)->'version'->>'version')::int = 1, 'reader serves published version';

  insert into public.note_versions(note_id, version, body_md) values (n, 0, '## Pain scales v2') returning id into v2;
  assert (public.note_reader(n)->'version'->>'version')::int = 1, 'drafts are not served to readers';
  assert (public.note_reader(n, v2)->'version'->>'is_preview')::boolean, 'editors can preview drafts';
  perform public.admin_review_note_version(v2, true);
  assert (select status from public.note_versions where id = v) = 'superseded', 'old version superseded';
  assert (select count(*) from public.search_notes('pain')) >= 1, 'full-text search finds published notes';
end $$;
reset role;
rollback;
