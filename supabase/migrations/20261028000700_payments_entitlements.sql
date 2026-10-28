-- =====================================================================
-- 0700 PRODUCTS, PAYMENTS, WEBHOOK EVENTS, REFUNDS, ENTITLEMENTS
-- Section C and Section D are separate products; buying one never grants
-- the other. Access is an explicit entitlement row with source + expiry.
-- payment_fulfill() is idempotent and only callable by the service role.
-- =====================================================================

create table if not exists public.products (
  code        text primary key check (code ~ '^[a-z_]{2,30}$'),
  name        text not null,
  description text,
  price_kobo  int not null check (price_kobo >= 0),
  currency    text not null default 'NGN' check (currency = 'NGN'),
  access_days int check (access_days is null or access_days > 0),  -- null = until revoked
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create or replace trigger products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete restrict,
  reference               text not null unique check (char_length(reference) between 10 and 100),
  purpose                 text not null check (purpose in ('product','ai_plan')),
  item_code               text not null,
  amount_kobo             int not null check (amount_kobo > 0),
  currency                text not null default 'NGN',
  status                  text not null default 'initialized'
                          check (status in ('initialized','success','failed','abandoned','refunded','amount_mismatch')),
  provider                text not null default 'paystack',
  mode                    text not null default 'test' check (mode in ('test','live')),
  provider_transaction_id text,
  channel                 text,
  paid_at                 timestamptz,
  verified_at             timestamptz,
  metadata                jsonb not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists payments_user on public.payments(user_id, created_at desc);
create index if not exists payments_status on public.payments(status, created_at desc);
create or replace trigger payments_updated before update on public.payments
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payment_events (
  id               bigint generated always as identity primary key,
  provider         text not null default 'paystack',
  event_key        text not null,            -- sha256 of raw body: duplicate deliveries collide
  event_type       text,
  reference        text,
  signature_valid  boolean not null,
  payload          jsonb not null,
  processed        boolean not null default false,
  processing_error text,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  unique (provider, event_key)
);
create index if not exists payment_events_ref on public.payment_events(reference);

create table if not exists public.refunds (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references public.payments(id),
  amount_kobo  int not null check (amount_kobo > 0),
  reason       text not null,
  status       text not null default 'recorded' check (status in ('recorded','processed','failed')),
  processed_by uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create table if not exists public.entitlements (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.products(code),
  source       text not null check (source in ('payment','admin_grant','promo')),
  status       text not null default 'active' check (status in ('active','revoked','expired')),
  starts_at    timestamptz not null default now(),
  expires_at   timestamptz,
  payment_id   uuid unique references public.payments(id),   -- one entitlement per payment
  granted_by   uuid references auth.users(id),
  reason       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (source <> 'payment' or payment_id is not null),
  check (source = 'payment' or granted_by is not null or source = 'promo')
);
create index if not exists entitlements_user on public.entitlements(user_id, product_code);
create or replace trigger entitlements_updated before update on public.entitlements
  for each row execute function public.tg_set_updated_at();

do $$ begin
  alter table public.ai_subscriptions
    add constraint ai_subscriptions_payment_fk foreign key (payment_id) references public.payments(id);
exception when duplicate_object then null; end $$;
create unique index if not exists ai_subscriptions_payment_uq on public.ai_subscriptions(payment_id) where payment_id is not null;

-- Does a user currently hold access to a product?
create or replace function public.user_has_entitlement(p_user uuid, p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.entitlements
     where user_id = p_user and product_code = p_product and status = 'active'
       and starts_at <= now() and (expires_at is null or expires_at > now())
  );
$$;

create or replace function public.has_entitlement(p_product text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.user_has_entitlement(auth.uid(), p_product);
$$;

-- Which product unlocks a bank / section.
create or replace function public.bank_product(p_bank public.question_bank)
returns text language sql immutable as $$
  select case p_bank when 'section_c' then 'section_c' when 'section_d' then 'section_d' else null end;
$$;

-- ---------------------------------------------------------------------
-- payment_fulfill: called by the server ONLY after verifying the
-- transaction with Paystack's API. Safe to call repeatedly.
-- ---------------------------------------------------------------------
create or replace function public.payment_fulfill(
  p_reference text, p_amount_kobo int, p_currency text,
  p_provider_txn text, p_channel text, p_paid_at timestamptz, p_raw jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pay public.payments;
  prod public.products;
  plan public.ai_plans;
  w public.credit_wallets;
  v_ent uuid;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_reference'); end if;

  if pay.status = 'success' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'payment_id', pay.id);
  end if;
  if pay.status in ('refunded') then
    return jsonb_build_object('ok', false, 'error', 'payment_refunded');
  end if;

  -- Never trust the client: amount and currency must match what WE priced.
  if p_amount_kobo is distinct from pay.amount_kobo or upper(coalesce(p_currency, '')) <> pay.currency then
    update public.payments set status = 'amount_mismatch', verified_at = now(),
      metadata = metadata || jsonb_build_object('verify', p_raw) where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  update public.payments set status = 'success', provider_transaction_id = p_provider_txn,
    channel = p_channel, paid_at = coalesce(p_paid_at, now()), verified_at = now(),
    metadata = metadata || jsonb_build_object('verify', p_raw)
  where id = pay.id;

  if pay.purpose = 'product' then
    select * into prod from public.products where code = pay.item_code;
    insert into public.entitlements(user_id, product_code, source, payment_id, starts_at, expires_at, reason)
    values (pay.user_id, pay.item_code, 'payment', pay.id, now(),
            case when prod.access_days is null then null else now() + make_interval(days => prod.access_days) end,
            'Paystack ' || p_reference)
    on conflict (payment_id) do nothing
    returning id into v_ent;

    insert into public.notifications(user_id, title, body, link)
    values (pay.user_id, prod.name || ' unlocked', 'Your payment was confirmed. Good luck with your preparation!',
            case pay.item_code when 'section_c' then '/mock' else '/final' end);

    return jsonb_build_object('ok', true, 'payment_id', pay.id, 'entitlement_id', v_ent);
  else
    select * into plan from public.ai_plans where code = pay.item_code;
    insert into public.ai_subscriptions(user_id, plan_code, source, payment_id, starts_at, ends_at, reason)
    values (pay.user_id, plan.code, 'payment', pay.id, now(), now() + make_interval(days => plan.period_days),
            'Paystack ' || p_reference)
    on conflict do nothing;

    -- Start a fresh period on the new plan; unused credits carry over once.
    w := public._wallet_lock(pay.user_id);
    update public.credit_wallets set
      plan_code = plan.code,
      balance = w.balance + plan.monthly_credits,
      period_start = now(), period_end = now() + make_interval(days => plan.period_days),
      images_used = 0, web_searches_used = 0, video_searches_used = 0, updated_at = now()
    where user_id = pay.user_id returning * into w;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note)
    values (pay.user_id, plan.monthly_credits, w.balance, 'plan_purchase', plan.name || ' plan purchased');

    insert into public.notifications(user_id, title, body, link)
    values (pay.user_id, plan.name || ' AI plan active', format('%s credits added to your wallet.', plan.monthly_credits), '/dashboard');

    return jsonb_build_object('ok', true, 'payment_id', pay.id, 'plan', plan.code, 'balance', w.balance);
  end if;
end $$;

-- Mark a non-successful verification outcome (failed/abandoned).
create or replace function public.payment_mark(p_reference text, p_status text, p_raw jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('failed','abandoned') then raise exception 'invalid_status'; end if;
  update public.payments set status = p_status, verified_at = now(),
         metadata = metadata || jsonb_build_object('verify', p_raw)
   where reference = p_reference and status = 'initialized';
end $$;
