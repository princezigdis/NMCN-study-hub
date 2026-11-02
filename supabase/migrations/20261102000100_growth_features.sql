-- =====================================================================
-- 20261102 GROWTH FEATURES (additive): referrals, locked study track with
-- paid switch, site banner / maintenance, YouTube cache.
-- Touches no existing data and nothing outside this app.
-- =====================================================================

-- ---------- profile columns ------------------------------------------
alter table public.profiles add column if not exists referral_code text;
alter table public.profiles add column if not exists referred_by uuid references public.profiles(id);
create unique index if not exists profiles_referral_code_uq on public.profiles(upper(referral_code)) where referral_code is not null;

create or replace function public._gen_referral_code() returns text language plpgsql as $$
declare c text; begin
  loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    exit when not exists (select 1 from public.profiles where upper(referral_code) = c);
  end loop;
  return c;
end $$;

update public.profiles set referral_code = public._gen_referral_code() where referral_code is null;

create or replace function public.tg_profile_referral_code() returns trigger language plpgsql as $$
begin
  if new.referral_code is null then new.referral_code := public._gen_referral_code(); end if;
  return new;
end $$;
drop trigger if exists profiles_referral_code on public.profiles;
create trigger profiles_referral_code before insert on public.profiles
  for each row execute function public.tg_profile_referral_code();

-- ---------- ledger reasons -------------------------------------------
alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('period_grant','period_expire','plan_purchase','ai_reserve','ai_refund','admin_adjustment','referral_bonus'));

-- ---------- referrals ------------------------------------------------
create table if not exists public.referrals (
  id             uuid primary key default gen_random_uuid(),
  referrer_id    uuid not null references public.profiles(id) on delete cascade,
  referred_id    uuid not null unique references public.profiles(id) on delete cascade,
  referrer_credits int not null default 0,
  referred_credits int not null default 0,
  created_at     timestamptz not null default now()
);
create index if not exists referrals_referrer on public.referrals(referrer_id, created_at desc);
alter table public.referrals enable row level security;
drop policy if exists referrals_read on public.referrals;
create policy referrals_read on public.referrals for select
  using (referrer_id = auth.uid() or referred_id = auth.uid() or public.has_permission('users.view'));
revoke insert, update, delete on public.referrals from anon, authenticated;

-- ---------- settings defaults (never overwrite admin edits) ----------
insert into public.app_settings(key, value, description) values
  ('referral.rewards', '{"enabled":true,"referrer_credits":20,"referred_credits":10,"max_per_referrer":50}', 'Referral rewards in AI credits'),
  ('pricing.track_switch_kobo', '100000', 'Fee in kobo to switch between RN and RM tracks (100000 = NGN 1,000)'),
  ('site.banner', '{"visible":false,"text":"","tone":"info"}', 'Announcement banner shown to every student'),
  ('site.maintenance', '{"enabled":false,"message":"We are making improvements and will be back shortly."}', 'Maintenance mode (staff can still sign in)'),
  ('video.filter', '{"medical_only":true}', 'Restrict the video hub to medical procedure content')
on conflict (key) do nothing;

-- Safe public read of site state (banner + maintenance only).
create or replace function public.site_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'banner', coalesce((select value from public.app_settings where key = 'site.banner'), '{}'::jsonb),
    'maintenance', coalesce((select value from public.app_settings where key = 'site.maintenance'), '{}'::jsonb));
$$;
grant execute on function public.site_state() to anon, authenticated;

-- Track switch fee for the signed-in student.
create or replace function public.track_switch_info() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; begin
  select value into v from public.app_settings where key = 'pricing.track_switch_kobo';
  return jsonb_build_object('fee_kobo', coalesce((v #>> '{}')::int, 100000));
end $$;
grant execute on function public.track_switch_info() to authenticated;

-- ---------- referral RPCs --------------------------------------------
create or replace function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p public.profiles; n int; earned int; cfg jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into p from public.profiles where id = uid;
  select count(*), coalesce(sum(referrer_credits), 0) into n, earned from public.referrals where referrer_id = uid;
  select value into cfg from public.app_settings where key = 'referral.rewards';
  return jsonb_build_object('code', p.referral_code, 'count', n, 'credits_earned', earned,
    'referred_by', p.referred_by is not null, 'rewards', coalesce(cfg, '{}'::jsonb));
end $$;
grant execute on function public.my_referral() to authenticated;

create or replace function public.set_referral_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c text := upper(trim(coalesce(p_code, '')));
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if c !~ '^[A-Z0-9]{4,16}$' then raise exception 'invalid_code'; end if;
  if exists (select 1 from public.profiles where upper(referral_code) = c and id <> uid) then raise exception 'code_taken'; end if;
  update public.profiles set referral_code = c where id = uid;
  return jsonb_build_object('code', c);
end $$;
grant execute on function public.set_referral_code(text) to authenticated;

create or replace function public.apply_referral(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); me public.profiles; ref public.profiles; cfg jsonb;
  rc int; dc int; cap int; cnt int; w public.credit_wallets;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into me from public.profiles where id = uid;
  if me.referred_by is not null or exists (select 1 from public.referrals where referred_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'already_referred');
  end if;
  if me.created_at < now() - interval '7 days' then return jsonb_build_object('ok', false, 'error', 'too_late'); end if;
  select * into ref from public.profiles where upper(referral_code) = upper(trim(coalesce(p_code, '')));
  if not found or ref.id = uid then return jsonb_build_object('ok', false, 'error', 'invalid_code'); end if;

  select value into cfg from public.app_settings where key = 'referral.rewards';
  cfg := coalesce(cfg, '{}');
  if coalesce((cfg->>'enabled')::boolean, true) = false then return jsonb_build_object('ok', false, 'error', 'disabled'); end if;
  rc := coalesce((cfg->>'referrer_credits')::int, 20);
  dc := coalesce((cfg->>'referred_credits')::int, 10);
  cap := coalesce((cfg->>'max_per_referrer')::int, 50);
  select count(*) into cnt from public.referrals where referrer_id = ref.id;
  if cnt >= cap then rc := 0; end if;

  update public.profiles set referred_by = ref.id where id = uid;
  insert into public.referrals(referrer_id, referred_id, referrer_credits, referred_credits) values (ref.id, uid, rc, dc);

  if rc > 0 then
    w := public._wallet_lock(ref.id);
    update public.credit_wallets set balance = balance + rc, updated_at = now() where user_id = ref.id returning * into w;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note) values (ref.id, rc, w.balance, 'referral_bonus', 'Referral reward');
    insert into public.notifications(user_id, title, body, link)
      values (ref.id, 'Referral reward', format('A friend joined with your code. %s credits added.', rc), '/profile');
  end if;
  if dc > 0 then
    w := public._wallet_lock(uid);
    update public.credit_wallets set balance = balance + dc, updated_at = now() where user_id = uid returning * into w;
    insert into public.credit_ledger(user_id, delta, balance_after, reason, note) values (uid, dc, w.balance, 'referral_bonus', 'Welcome bonus');
  end if;
  return jsonb_build_object('ok', true, 'credits', dc);
end $$;
grant execute on function public.apply_referral(text) to authenticated;

-- ---------- track lock -----------------------------------------------
-- After a programme is chosen, only a verified track-switch payment
-- (payment_fulfill sets app.track_switch) or the service role may change it.
create or replace function public.tg_lock_track() returns trigger language plpgsql as $$
begin
  if old.programme_id is not null and new.programme_id is distinct from old.programme_id
     and auth.uid() is not null and coalesce(current_setting('app.track_switch', true), '') <> 'on' then
    raise exception 'track_locked';
  end if;
  return new;
end $$;
drop trigger if exists profiles_lock_track on public.profiles;
create trigger profiles_lock_track before update of programme_id on public.profiles
  for each row execute function public.tg_lock_track();

alter table public.payments drop constraint if exists payments_purpose_check;
alter table public.payments add constraint payments_purpose_check check (purpose in ('product','ai_plan','track_switch'));

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
  v_prog uuid;
begin
  select * into pay from public.payments where reference = p_reference for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'unknown_reference'); end if;

  if pay.status = 'success' then
    return jsonb_build_object('ok', true, 'already_processed', true, 'payment_id', pay.id);
  end if;
  if pay.status in ('refunded') then
    return jsonb_build_object('ok', false, 'error', 'payment_refunded');
  end if;

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

  elsif pay.purpose = 'track_switch' then
    select id into v_prog from public.programmes where code = pay.item_code and active;
    if v_prog is null then return jsonb_build_object('ok', false, 'error', 'unknown_track'); end if;
    perform set_config('app.track_switch', 'on', true);
    update public.profiles set programme_id = v_prog where id = pay.user_id;
    perform set_config('app.track_switch', 'off', true);
    insert into public.notifications(user_id, title, body, link)
    values (pay.user_id, 'Track switched', 'Your study track is now ' || pay.item_code || '.', '/library');
    return jsonb_build_object('ok', true, 'payment_id', pay.id, 'track', pay.item_code);

  else
    select * into plan from public.ai_plans where code = pay.item_code;
    insert into public.ai_subscriptions(user_id, plan_code, source, payment_id, starts_at, ends_at, reason)
    values (pay.user_id, plan.code, 'payment', pay.id, now(), now() + make_interval(days => plan.period_days),
            'Paystack ' || p_reference)
    on conflict do nothing;

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

-- ---------- YouTube cache (server only) -------------------------------
create table if not exists public.youtube_cache (
  query_key  text primary key,
  results    jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.youtube_cache enable row level security;
revoke all on public.youtube_cache from anon, authenticated;

revoke execute on function public._gen_referral_code(), public.tg_profile_referral_code(), public.tg_lock_track() from public, anon, authenticated;

-- (applied separately) per-user throttle log for the video hub
create table if not exists public.youtube_cache_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists youtube_cache_log_user on public.youtube_cache_log(user_id, created_at desc);
alter table public.youtube_cache_log enable row level security;
revoke all on public.youtube_cache_log from anon, authenticated;
