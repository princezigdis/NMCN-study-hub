-- =====================================================================
-- 1300 REFERENCE DATA needed in every environment (idempotent upserts).
-- Prices, credits and limits are STARTING VALUES. Change them in the
-- admin dashboard (AI & Plans / Payments) rather than here.
-- =====================================================================

insert into public.programmes(code, name, description) values
  ('RN', 'Registered Nursing', 'General nursing pathway'),
  ('RM', 'Registered Midwifery', 'Midwifery pathway')
on conflict (code) do nothing;

-- Role -> permission matrix. '*' = all permissions.
insert into public.role_permissions(role, permission) values
  ('super_admin', '*'),
  ('content_admin', 'content.manage'), ('content_admin', 'content.review'), ('content_admin', 'reports.manage'),
  ('content_admin', 'users.view'),
  ('question_admin', 'questions.manage'), ('question_admin', 'reports.manage'),
  ('reviewer', 'content.review'), ('reviewer', 'questions.review'), ('reviewer', 'reports.manage'),
  ('exam_admin', 'exams.manage'), ('exam_admin', 'questions.manage'),
  ('support', 'users.view'), ('support', 'users.manage'), ('support', 'access.grant'),
  ('support', 'support.manage'), ('support', 'reports.manage'), ('support', 'notifications.send'),
  ('finance', 'payments.view'), ('finance', 'payments.manage'), ('finance', 'pricing.manage'), ('finance', 'users.view')
on conflict do nothing;

-- Exam products (prices in kobo: ₦1,500 = 150000 kobo).
insert into public.products(code, name, description, price_kobo, access_days) values
  ('section_c', 'Section C — Mock Examination',
   'Timed Papers 1–3 objective practice plus Paper 4 viva/CAOSCE-style practice.', 150000, 365),
  ('section_d', 'Section D — Final Examination Simulator',
   'Separate full-length final-exam simulations with readiness tracking.', 500000, 365)
on conflict (code) do nothing;

-- AI plans: 1x / 4x / 16x / 64x credits. Paid prices are placeholders.
insert into public.ai_plans(code, name, monthly_credits, price_kobo, image_limit, web_search_limit, video_search_limit, position) values
  ('free',     'Free',       100,       0,  2,   5,  10, 0),
  ('standard', 'Standard',   400,  150000,  8,  20,  40, 1),
  ('pro',      'Pro',       1600,  400000, 30,  80, 160, 2),
  ('ultra',    'Ultra',     6400, 1000000, 120, 320, 640, 3)
on conflict (code) do nothing;

-- Different operations cost different credits.
insert into public.ai_action_costs(action, label, credits, tier, max_output_tokens, est_provider_cost_usd, description) values
  ('explain_simple',     'Explain simply',            1, 'fast',          700, 0.002, 'Plain-language explanation of the selection'),
  ('explain_exam',       'Explain at exam level',     2, 'strong',       1000, 0.012, 'Nursing/midwifery examination-level explanation'),
  ('summarize',          'Summarise',                 1, 'fast',          600, 0.002, 'Concise revision summary'),
  ('expand_notes',       'Expand into detailed notes',4, 'strong',       2000, 0.030, 'Detailed study notes grounded in the library'),
  ('differentiate',      'Differentiate concepts',    3, 'strong',       1400, 0.020, 'Side-by-side comparison table'),
  ('flashcards',         'Make flashcards',           3, 'fast',         1400, 0.004, 'Question/answer cards saved to your deck'),
  ('mnemonic',           'Create a mnemonic',         1, 'fast',          400, 0.001, 'Memory aid for a list or sequence'),
  ('practice_questions', 'Generate practice questions',5,'strong',       2200, 0.035, 'Unverified AI practice MCQs with rationales'),
  ('follow_up',          'Ask a follow-up question',  1, 'fast',          800, 0.003, 'Question about the selected content'),
  ('rationale_expand',   'Expand the rationale',      2, 'strong',       1000, 0.012, 'Deeper explanation of an answered question'),
  ('viva_feedback',      'Viva/CAOSCE feedback',      4, 'strong',       1500, 0.025, 'Practice feedback against the station rubric'),
  ('diagram',            'Create a diagram',         20, 'image',          50, 0.060, 'Educational illustration'),
  ('web_search',         'Search trusted sources',    5, 'web_search',   1200, 0.030, 'Web search with citations'),
  ('video_search',       'Find videos',               2, 'video_search',   50, 0.000, 'Relevant educational YouTube videos')
on conflict (action) do nothing;

insert into public.app_settings(key, value, description) values
  ('ai.config', jsonb_build_object(
      'enabled', true,
      'text_provider', 'anthropic',
      'fast_model', 'claude-haiku-5-5',
      'strong_model', 'claude-sonnet-5-5',
      'fallback_provider', 'openai',
      'fallback_fast_model', '',
      'fallback_strong_model', '',
      'image_provider', 'openai',
      'image_model', 'gpt-image-1',
      'image_size', '1024x1024',
      'daily_budget_usd', 20,
      'per_user_per_minute', 10,
      'max_input_chars', 12000,
      'timeout_ms', 45000,
      'pricing', '{}'::jsonb),
   'AI provider/model selection and budget controls. API keys are NOT stored here (Edge Function secrets).'),
  ('payments.config', jsonb_build_object('provider', 'paystack', 'mode', 'test', 'callback_path', '/payment/callback'),
   'Payment provider mode. Keys live in Edge Function secrets.')
on conflict (key) do nothing;

insert into public.feature_flags(key, enabled, description) values
  ('ai_assistant', true,  'AI study assistant across the app'),
  ('ai_images',    true,  'AI diagram generation'),
  ('video_search', true,  'YouTube educational video search'),
  ('web_search',   false, 'AI web search with citations (enable after testing)'),
  ('section_c',    true,  'Section C mock examination'),
  ('section_d',    true,  'Section D final examination simulator'),
  ('maintenance_banner', false, 'Show a maintenance banner to students')
on conflict (key) do nothing;
