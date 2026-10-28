-- Practice engine (Section B) and exam timing/scoring (Sections C/D).
begin;
set search_path = public, extensions;

insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000c1', 'practice@example.test');
-- Complimentary Section D access, granted directly as the database owner for setup.
insert into public.entitlements(user_id, product_code, source, reason)
values ('00000000-0000-0000-0000-0000000000c1', 'section_d', 'promo', 'test setup');

-- Keep the answer key in a temp table that only the test (owner) reads.
create temp table key as select question_id, id as option_id, is_correct from public.question_options;
grant select on key to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

do $$
declare
  s jsonb; v_session uuid; g jsonb; item jsonb; r jsonb; ok boolean;
  wrong_q uuid; v_correct uuid; v_wrong uuid; n int := 0;
begin
  -- Only the allowed sizes
  ok := false;
  begin perform public.practice_start(15);
  exception when others then ok := sqlerrm = 'invalid_count'; end;
  assert ok, 'only 10/20/25/50/100 allowed';

  s := public.practice_start(10, 'RN');
  v_session := (s->>'session_id')::uuid;
  assert (s->>'question_count')::int between 1 and 10, 'session created';

  -- Filtering by programme: RM-only course questions excluded? (demo questions are RN+RM) -> topic filter check
  assert (public.practice_start(10, null, null,
           (select id from public.topics where title = 'Stages of Labour'))->>'question_count')::int = 1, 'topic filter';

  g := public.practice_get(v_session);
  assert (g->'items'->0->'feedback') = 'null'::jsonb, 'no rationale before answering';
  assert jsonb_array_length(g->'items'->0->'options') = 4, 'options delivered';
  assert not ((g->'items'->0->'options'->0) ? 'is_correct'), 'options do not leak correctness';

  for item in select * from jsonb_array_elements(g->'items') loop
    n := n + 1;
    select option_id into v_correct from key where question_id = (item->>'question_id')::uuid and is_correct;
    select option_id into v_wrong from key where question_id = (item->>'question_id')::uuid and not is_correct limit 1;
    if n = 1 then
      r := public.practice_answer(v_session, (item->>'position')::int, v_wrong);
      assert (r->>'is_correct')::boolean = false, 'wrong answer marked wrong';
      assert jsonb_array_length(r->'feedback'->'options') = 4, 'rationale for every option returned';
      assert (r->'feedback'->>'correct_option_id')::uuid = v_correct, 'correct option revealed after answering';
      wrong_q := (item->>'question_id')::uuid;
      -- Cannot change an answer once given
      r := public.practice_answer(v_session, (item->>'position')::int, v_correct);
      assert (r->>'already_answered')::boolean, 'answers are final';
    else
      r := public.practice_answer(v_session, (item->>'position')::int, v_correct);
      assert (r->>'is_correct')::boolean, 'correct answer marked correct';
    end if;
  end loop;

  assert (select status from public.practice_sessions where id = v_session) = 'completed', 'session completes';
  assert (select correct_count from public.practice_sessions where id = v_session) = n - 1, 'score counts';

  -- Option from another question is rejected
  ok := false;
  s := public.practice_start(10);
  begin perform public.practice_answer((s->>'session_id')::uuid, 1, gen_random_uuid());
  exception when others then ok := sqlerrm = 'invalid_option'; end;
  assert ok, 'invalid option rejected';

  -- Retry incorrect contains exactly the missed question
  s := public.practice_start(10, null, null, null, null, 'retry_incorrect');
  g := public.practice_get((s->>'session_id')::uuid);
  assert jsonb_array_length(g->'items') = 1 and (g->'items'->0->>'question_id')::uuid = wrong_q, 'retry incorrect works';

  -- Saved questions mode with nothing saved
  ok := false;
  begin perform public.practice_start(10, null, null, null, null, 'saved');
  exception when others then ok := sqlerrm = 'no_questions_available'; end;
  assert ok, 'saved mode with no bookmarks reports empty';

  assert (select count(*) from public.my_topic_stats()) >= 1, 'topic stats computed';
  assert (public.my_dashboard()->'practice'->>'answered')::int = n + 0, 'dashboard counts answers';
end $$;

-- ---------- Section D attempt: full marks, then a timed-out attempt ----------
do $$
declare v_att uuid; g jsonb; item jsonb; v_correct uuid; r jsonb;
begin
  v_att := (public.exam_start((select p.id from public.exam_papers p join public.exam_configs c on c.id = p.config_id
                                where c.section = 'D' limit 1))->>'attempt_id')::uuid;
  g := public.exam_get(v_att);
  for item in select * from jsonb_array_elements(g->'items') loop
    select option_id into v_correct from key where question_id = (item->>'question_id')::uuid and is_correct;
    perform public.exam_save_answer(v_att, (item->>'position')::int, v_correct, false);
  end loop;
  r := public.exam_submit(v_att);
  assert (r->>'percent')::numeric = 100, 'all-correct scores 100%';
  assert (r->>'passed')::boolean, 'pass mark applied';
  assert jsonb_array_length(r->'by_topic') >= 1, 'topic breakdown';
  assert (public.my_dashboard()->'readiness'->>'attempts')::int = 1, 'readiness uses Section D attempts';
end $$;

reset role;
-- Simulate the clock running out on a second attempt.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
create temp table att as select (public.exam_start((select p.id from public.exam_papers p join public.exam_configs c on c.id = p.config_id
                                where c.section = 'D' limit 1))->>'attempt_id')::uuid as id;
reset role;
update public.exam_attempts set deadline_at = now() - interval '1 minute' where id = (select id from att);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
declare r jsonb; v uuid := (select id from att);
begin
  r := public.exam_save_answer(v, 1, null, false);
  assert r->>'error' = 'time_up', 'late answers rejected';
  assert (select status from public.exam_attempts where id = v) = 'expired', 'attempt auto-closed at deadline';
  assert (public.exam_get(v)->'result'->>'total')::int = 4, 'expired attempt still scored';
end $$;

reset role;
rollback;
