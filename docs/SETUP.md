# Setup, deployment and operations

Follow the steps in order. Nothing here has been run against your real Supabase project or Paystack account yet. Every external credential is still **awaiting setup**.

## 0. Accounts you need

| Service | Used for | Notes |
|---|---|---|
| Supabase | Database, auth, storage, server functions | Pro plan recommended before launch (daily backups and point-in-time recovery) |
| Paystack | Nigerian card, bank transfer and USSD payments | Start with **test** keys. A live key requires a verified business. |
| Anthropic | Text AI (explanations, rationales, flashcards…) | Create an API key and set a monthly spend limit in the console |
| OpenAI | Diagram images (and an optional text fallback) | Set a monthly spend limit |
| Google Cloud | YouTube Data API v3 (video search) | Free daily quota; restrict the key to that API |
| Static host | The website | Vercel, Netlify or Cloudflare Pages (rewrite files are included) |

## 1. Run the frontend locally

```bash
npm install
cp .env.example .env.local      # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                      # http://localhost:5173
```

Only `VITE_*` values go in `.env.local`, and they are public by design. **Never** put a secret key in a `VITE_` variable.

## 2. Database (Supabase)

### Local development (safe sandbox)

```bash
npm i -g supabase                # or: brew install supabase/tap/supabase
supabase start                   # local Postgres + auth + storage in Docker
supabase db reset                # LOCAL ONLY: applies migrations + demo seed
```

### Your hosted project

**Quickest way (no tools needed):** open Supabase Dashboard → **SQL Editor** → **New query**, paste the whole of
`supabase/setup_all.sql`, then click **Run**. It contains all 16 migrations in order and is safe to run again.
Regenerate it after changing migrations:
`for f in supabase/migrations/*.sql; do cat "$f"; echo; echo "reset search_path;"; done > supabase/setup_all.sql`.

When creating the project, choose these API settings:

| Setting | Choice | Why |
|---|---|---|
| Enable Data API | **On** | The app talks to the database through it (supabase-js). |
| Automatically expose new tables | **Off** (recommended) | The migrations grant exactly what the app needs, so nothing you add later becomes public by accident. The app works with it on too. |
| Enable automatic RLS | **On** | A safety net for any table created later. The migrations already turn RLS on for every table. |

1. **Back up first** if the project already has data: `supabase db dump -f backup-$(date +%F).sql` (and `--data-only` for a data copy).
2. Read the migrations in `supabase/migrations` (they are additive and use `if not exists` and `on conflict do nothing`).
3. Link and push:
   ```bash
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push                 # applies only migrations not yet applied
   ```
4. **Don't load `seed.sql` into production.** It is demonstration content. To try the demo on a staging project, run it once in the SQL editor and archive it before launch.
5. In **Dashboard → Authentication → URL configuration**, set the Site URL to your domain. Add `https://YOUR-DOMAIN/reset-password` and `https://YOUR-DOMAIN/onboarding` as redirect URLs.
6. In **Authentication → Emails**, set up custom SMTP (Resend, Postmark, SES…) so confirmation and reset emails are delivered reliably.

### Create the first administrator (securely)

1. Sign up in the app with the owner's email and confirm it.
2. In **Supabase Dashboard → SQL Editor** (only project owners can open this), run:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'super_admin' from auth.users where email = 'owner@example.com';
   ```
3. Sign out and back in. **Admin console** now appears. Grant other roles from **Admin → Users → (person) → Admin roles**.

You can't make yourself an admin from the app. Role changes are only possible for an existing super admin, and they are audited.

## 3. Server functions and secrets

```bash
supabase secrets set \
  ANTHROPIC_API_KEY=sk-ant-... \
  OPENAI_API_KEY=sk-... \
  YOUTUBE_API_KEY=AIza... \
  PAYSTACK_SECRET_KEY=sk_test_... \
  APP_URL=https://your-domain.com \
  ALLOWED_ORIGINS=https://your-domain.com,http://localhost:5173

supabase functions deploy ai-assist payments-initialize payments-verify payments-webhook admin-users admin-ai-test
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically. `payments-webhook` is deployed with JWT verification off (see `supabase/config.toml`), because Paystack signs its requests instead.

For local function testing, put the same values in `supabase/.env.local` (git-ignored) and run `npm run functions:serve`.

## 4. AI provider

* Defaults live in **Admin → AI & plans → Provider & budget**: Anthropic, with `claude-haiku-5-5` (fast tasks) and `claude-sonnet-5-5` (deep explanations). Images use OpenAI `gpt-image-1`. Check current model names in each provider's docs and change them there. No code change is needed.
* Use **Test provider** to confirm a key and model work before switching.
* Set a **daily budget cap (USD)**. When today's estimated spend reaches it, AI pauses for everyone and students see a friendly message. For accurate estimates, add token prices from your provider's price list in the pricing JSON.
* Evaluate output quality with real NMCN-style test cases (explanations, rationales, viva feedback) before choosing the final provider. The provider is switchable at any time.
* Turn on `web_search` in **Settings → Feature flags** only after testing it (it uses Anthropic's server-side web search tool).

## 5. Payments (Paystack)

1. Paystack Dashboard → Settings → API Keys & Webhooks:
   * **Webhook URL**: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/payments-webhook`
   * **Callback URL**: none needed (the app sends one per transaction).
2. Use the **test** secret key (`sk_test_…`) and Paystack's test cards to buy Section C, Section D and an AI plan. Confirm that access unlocks, the webhook event shows *processed* in **Admin → Payments → Webhook events**, and repeating the webhook doesn't double-grant.
3. **Going live**: verify the business on Paystack, set `PAYSTACK_SECRET_KEY` to the `sk_live_…` key, then switch **Admin → Settings → Payments** to *Live*. The server refuses checkouts whenever the key type and the setting disagree, so you can't charge real cards by accident.
4. Refunds: issue the refund in the Paystack dashboard, then **Admin → Payments → Record refund**. That records it and removes the access it bought.

Prices: Section C ₦1,500 and Section D ₦5,000 (edit in **Admin → Payments → Exam prices**). AI plan prices are placeholders (Standard ₦1,500 / Pro ₦4,000 / Ultra ₦10,000 per 30 days). Set your real prices in **Admin → AI & plans → Plans & pricing**.

## 6. Deploy the website

```bash
npm run build      # outputs dist/
```

* **Vercel**: import the repo, framework *Vite*, and add the `VITE_*` env vars. `vercel.json` handles SPA routes and security headers.
* **Netlify / Cloudflare Pages**: build command `npm run build`, publish directory `dist`. `public/_redirects` handles SPA routes.
* Add the final domain to Supabase Auth URLs, `APP_URL` and `ALLOWED_ORIGINS`.

## 7. Tests

```bash
npm test           # unit tests: CSV import, spaced repetition, AI prompts/providers, Paystack signatures, routing
npm run test:db    # migrations + seed + RLS/scoring/credits/payments tests on a THROWAWAY local Postgres
npm run typecheck
```

`test:db` needs Postgres 15+ binaries (`initdb`, `pg_ctl`). It creates a temporary cluster and deletes it afterwards. It never touches your Supabase project. It must run as a non-root user (Postgres refuses root).

## 8. Backup and recovery

* **Automatic**: Supabase Pro takes daily backups. Enable **Point-in-Time Recovery** for minute-level restores before launch.
* **Manual, before every migration**: `supabase db dump -f pre-migration.sql` and `supabase db dump --data-only -f pre-migration-data.sql`. Store them off-site.
* **Storage files**: notes images and attachments live in the `content` and `question-images` buckets. Export them periodically (Supabase CLI `storage` commands or the S3-compatible API).
* **Restore drill**: restore a backup into a new staging project at least once before launch. Then run `npm run test:db` against a dump to confirm the schema is intact.
* Audit logs and payment records are append-only, so keep them in backups. Don't delete users who have payments (the database blocks it on purpose). Suspend them instead.
