-- =====================================================================
-- 0600 AI PLANS, CREDIT WALLETS, LEDGER, REQUEST LOG
-- Credits are only moved by ai_reserve / ai_complete (service role) and
-- admin RPCs. Wallet rows are locked FOR UPDATE, so concurrent requests
-- cannot overspend, and idempotency keys prevent double deductions.
-- =====================================================================

create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now()
);
create or replace trigger app_settings_updated before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text,
  updated_at  timestamptz not null default now()
);
create or replace trigger feature_flags_updated before update on public.feature_flags
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_plans (
  code               text primary key check (code ~ '^[a-z_]{2,20}$'),
  name               text not null,
  monthly_credits    int not null check (monthly_credits >= 0),
  price_kobo         int not null default 0 check (price_kobo >= 0),
  period_days        int not null default 30 check (period_days between 1 and 366),
  image_limit        int not null default 0 check (image_limit >= 0),
  web_search_limit   int not null default 0 check (web_search_limit >= 0),
  video_search_limit int not null default 0 check (video_search_limit >= 0),
  allowed_actions    text[] not null default '{*}',  -- '*' = every enabled action
  position           int not null default 0,
  active             boolean not null default true,
  updated_at         timestamptz not null default now()
);
create or replace trigger ai_plans_updated before update on public.ai_plans
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_action_costs (
  action                text primary key,
  label                 text not null,
  credits               int not null check (credits > 0),
  tier                  text not null check (tier in ('fast','strong','image','web_search','video_search')),
  max_output_tokens     int not null default 800 check (max_output_tokens between 50 and 8000),
  est_provider_cost_usd numeric(10,5) not null default 0,  -- fallback estimate per request
  enabled               boolean not null default true,
  description           text,
  updated_at            timestamptz not null default now()
);
create or replace trigger ai_action_costs_updated before update on public.ai_action_costs
  for each row execute function public.tg_set_updated_at();

create table if not exists public.ai_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  plan_code  text not null references public.ai_plans(code),
  status     text not null default 'active' check (status in ('active','expired','cancelled')),
  source     text not null check (source in ('payment','admin_grant','promo')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  payment_id uuid,             -- FK added in 0700
  granted_by uuid references auth.users(id),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists ai_subscriptions_user on public.ai_subscriptions(user_id, ends_at desc);

create table if not exists public.credit_wallets (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  plan_code           text not null default 'free' references public.ai_plans(code),
  balance             int not null default 0 check (balance >= 0),
  period_start        timestamptz not null default now(),
  period_end          timestamptz not null default now(),   -- past => refreshed on next use
  images_used         int not null default 0 check (images_used >= 0),
  web_searches_used   int not null default 0 check (web_searches_used >= 0),
  video_searches_used int not null default 0 check (video_searches_used >= 0),
  updated_at          timestamptz not null default now()
);

create table if not exists public.ai_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  action           text not null references public.ai_action_costs(action),
  status           text not null default 'reserved' check (status in ('reserved','succeeded','failed','refunded')),
  idempotency_key  text not null check (char_length(idempotency_key) between 8 and 100),
  credits_reserved int not null,
  credits_charged  int not null default 0,
  provider         text,
  model            text,
  input_tokens     int,
  output_tokens    int,
  est_cost_usd     numeric(10,5),
  latency_ms       int,
  error_code       text,
  context          jsonb not null default '{}',   -- ids only (note/question), never personal data
  output_excerpt   text,                          -- kept for error reports / review
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  unique (user_id, idempotency_key)
);
create index if not exists ai_requests_user_time on public.ai_requests(user_id, created_at desc);
create index if not exists ai_requests_time on public.ai_requests(created_at desc);

create table if not exists public.credit_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         int not null,
  balance_after int not null check (balance_after >= 0),
  reason        text not null check (reason in ('period_grant','period_expire','plan_purchase','ai_reserve','ai_refund','admin_adjustment')),
  ai_request_id uuid references public.ai_requests(id) on delete set null,
  actor_id      uuid references auth.users(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists credit_ledger_user on public.credit_ledger(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Internal: fetch + lock a wallet, creating it and rolling the monthly
-- period when needed. Caller must already be inside a transaction.
-- ---------------------------------------------------------------------
create or replace function public._wallet_lock(p_user uuid)
returns public.credit_wallets
language plpgsql security definer set search_path = public as $$
declare
  w public.credit_wallets;
  v_plan public.ai_plans;
  v_code text;
begin
  insert into public.credit_wallets(user_id) values (p_user) on conflict do nothing;
  select * into w from public.credit_wallets where user_id = p_user for update;

  if now() >= w.period_end then
    -- Highest active paid plan, else free.
    select s.plan_code into v_code
      from public.ai_subscriptions s join public.ai_plans p on p.code = s.plan_code
     where s.user_id = p_user and s.status = 'active' and s.starts_at <= now() and s.ends_at > now()
     order by p.monthly_credits desc limit 1;
    v_code := coalesce(v_code, 'free');
    select * into v_plan from public.ai_plans where code = v_code;
    if not found then
      raise exception 'ai_plan_missing:%', v_code;
    end if;

    if w.balance > 0 then
      insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
      values (p_user, -w.balance, 0, 'period_expire', 'Unused credits expire at period end');
    end if;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
    values (p_user, v_plan.monthly_credits, v_plan.monthly_credits, 'period_grant', v_plan.name || ' monthly credits');

    update public.credit_wallets set
      plan_code = v_code, balance = v_plan.monthly_credits,
      period_start = now(),
      period_end = least(now() + make_interval(days => v_plan.period_days),
                         coalesce((select max(ends_at) from public.ai_subscriptions
                                    where user_id = p_user and plan_code = v_code and status = 'active'
                                      and v_code <> 'free'), 'infinity')),
      images_used = 0, web_searches_used = 0, video_searches_used = 0, updated_at = now()
    where user_id = p_user
    returning * into w;
  end if;
  return w;
end $$;

-- ---------------------------------------------------------------------
-- ai_reserve: validate + deduct credits BEFORE calling the provider.
-- Returns jsonb { ok, request_id, credits, balance, duplicate, error }.
-- ---------------------------------------------------------------------
create or replace function public.ai_reserve(p_user uuid, p_action text, p_idem text, p_context jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w public.credit_wallets;
  v_cost public.ai_action_costs;
  v_plan public.ai_plans;
  v_existing public.ai_requests;
  v_cfg jsonb;
  v_recent int;
  v_spent numeric;
  v_req uuid;
begin
  -- Idempotency: same key returns the original reservation, no new charge.
  select * into v_existing from public.ai_requests where user_id = p_user and idempotency_key = p_idem;
  if found then
    return jsonb_build_object('ok', v_existing.status in ('reserved','succeeded'), 'duplicate', true,
      'request_id', v_existing.id, 'status', v_existing.status, 'credits', v_existing.credits_reserved,
      'error', case when v_existing.status in ('failed','refunded') then 'previous_attempt_failed' end);
  end if;

  if not exists (select 1 from public.profiles where id = p_user and status = 'active') then
    return jsonb_build_object('ok', false, 'error', 'account_suspended');
  end if;

  select * into v_cost from public.ai_action_costs where action = p_action;
  if not found or not v_cost.enabled then
    return jsonb_build_object('ok', false, 'error', 'action_disabled');
  end if;

  select coalesce(value, '{}') into v_cfg from public.app_settings where key = 'ai.config';
  v_cfg := coalesce(v_cfg, '{}');

  -- Global kill switch & daily provider budget cap.
  if coalesce((v_cfg->>'enabled')::boolean, true) = false then
    return jsonb_build_object('ok', false, 'error', 'ai_disabled');
  end if;
  select coalesce(sum(coalesce(est_cost_usd, 0)), 0) into v_spent
    from public.ai_requests where created_at >= date_trunc('day', now()) and status <> 'refunded';
  if (v_cfg ? 'daily_budget_usd') and v_spent >= (v_cfg->>'daily_budget_usd')::numeric then
    return jsonb_build_object('ok', false, 'error', 'budget_exceeded');
  end if;

  w := public._wallet_lock(p_user);   -- row lock serialises this user's requests

  -- Per-user rate limit (requests per minute).
  select count(*) into v_recent from public.ai_requests
   where user_id = p_user and created_at > now() - interval '1 minute';
  if v_recent >= coalesce((v_cfg->>'per_user_per_minute')::int, 10) then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  select * into v_plan from public.ai_plans where code = w.plan_code;
  if not (v_plan.allowed_actions @> array['*'] or v_plan.allowed_actions @> array[p_action]) then
    return jsonb_build_object('ok', false, 'error', 'plan_upgrade_required', 'plan', w.plan_code);
  end if;
  if v_cost.tier = 'image' and w.images_used >= v_plan.image_limit then
    return jsonb_build_object('ok', false, 'error', 'image_limit_reached', 'limit', v_plan.image_limit);
  end if;
  if v_cost.tier = 'web_search' and w.web_searches_used >= v_plan.web_search_limit then
    return jsonb_build_object('ok', false, 'error', 'web_search_limit_reached', 'limit', v_plan.web_search_limit);
  end if;
  if v_cost.tier = 'video_search' and w.video_searches_used >= v_plan.video_search_limit then
    return jsonb_build_object('ok', false, 'error', 'video_search_limit_reached', 'limit', v_plan.video_search_limit);
  end if;
  if w.balance < v_cost.credits then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits',
      'balance', w.balance, 'credits', v_cost.credits);
  end if;

  insert into public.ai_requests(user_id, action, idempotency_key, credits_reserved, context)
  values (p_user, p_action, p_idem, v_cost.credits, coalesce(p_context, '{}'))
  returning id into v_req;

  update public.credit_wallets set
    balance = balance - v_cost.credits,
    images_used = images_used + (v_cost.tier = 'image')::int,
    web_searches_used = web_searches_used + (v_cost.tier = 'web_search')::int,
    video_searches_used = video_searches_used + (v_cost.tier = 'video_search')::int,
    updated_at = now()
  where user_id = p_user
  returning * into w;

  insert into public.credit_ledger(user_id, delta, balance_after, reason, ai_request_id)
  values (p_user, -v_cost.credits, w.balance, 'ai_reserve', v_req);

  return jsonb_build_object('ok', true, 'duplicate', false, 'request_id', v_req,
    'credits', v_cost.credits, 'balance', w.balance, 'tier', v_cost.tier,
    'max_output_tokens', v_cost.max_output_tokens, 'est_cost_usd', v_cost.est_provider_cost_usd);
end $$;

-- ---------------------------------------------------------------------
-- ai_complete: settle a reservation. Failure => full refund.
-- Idempotent: only acts while status = 'reserved'.
-- ---------------------------------------------------------------------
create or replace function public.ai_complete(
  p_request uuid, p_success boolean,
  p_provider text default null, p_model text default null,
  p_input_tokens int default null, p_output_tokens int default null,
  p_cost_usd numeric default null, p_latency_ms int default null,
  p_error text default null, p_excerpt text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.ai_requests;
  v_tier text;
  w public.credit_wallets;
begin
  select * into r from public.ai_requests where id = p_request for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'request_not_found'); end if;
  if r.status <> 'reserved' then
    select * into w from public.credit_wallets where user_id = r.user_id;
    return jsonb_build_object('ok', true, 'already_settled', true, 'status', r.status, 'balance', w.balance);
  end if;

  if p_success then
    update public.ai_requests set status = 'succeeded', credits_charged = credits_reserved,
      provider = p_provider, model = p_model, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      est_cost_usd = p_cost_usd, latency_ms = p_latency_ms, output_excerpt = left(p_excerpt, 4000),
      completed_at = now()
    where id = p_request;
    select * into w from public.credit_wallets where user_id = r.user_id;
    return jsonb_build_object('ok', true, 'status', 'succeeded', 'balance', w.balance);
  end if;

  select tier into v_tier from public.ai_action_costs where action = r.action;
  perform 1 from public.credit_wallets where user_id = r.user_id for update;
  update public.credit_wallets set
    balance = balance + r.credits_reserved,
    images_used = greatest(images_used - (v_tier = 'image')::int, 0),
    web_searches_used = greatest(web_searches_used - (v_tier = 'web_search')::int, 0),
    video_searches_used = greatest(video_searches_used - (v_tier = 'video_search')::int, 0),
    updated_at = now()
  where user_id = r.user_id
  returning * into w;

  insert into public.credit_ledger(user_id, delta, balance_after, reason, ai_request_id, note)
  values (r.user_id, r.credits_reserved, w.balance, 'ai_refund', r.id, left(coalesce(p_error, 'failed'), 200));

  update public.ai_requests set status = 'refunded', credits_charged = 0,
    provider = p_provider, model = p_model, latency_ms = p_latency_ms,
    est_cost_usd = coalesce(p_cost_usd, 0), error_code = left(p_error, 200), completed_at = now()
  where id = p_request;

  return jsonb_build_object('ok', true, 'status', 'refunded', 'balance', w.balance);
end $$;

-- Student-facing: read (and lazily roll) my own wallet.
create or replace function public.my_wallet()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_active_user(); w public.credit_wallets; p public.ai_plans;
begin
  w := public._wallet_lock(uid);
  select * into p from public.ai_plans where code = w.plan_code;
  return jsonb_build_object(
    'plan_code', w.plan_code, 'plan_name', p.name, 'balance', w.balance,
    'monthly_credits', p.monthly_credits, 'period_end', w.period_end,
    'images_used', w.images_used, 'image_limit', p.image_limit,
    'web_searches_used', w.web_searches_used, 'web_search_limit', p.web_search_limit,
    'video_searches_used', w.video_searches_used, 'video_search_limit', p.video_search_limit);
end $$;
