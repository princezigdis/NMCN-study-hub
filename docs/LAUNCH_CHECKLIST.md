# Launch checklist and known limitations

## What's been verified (in this build environment)

| Check | How | Result |
|---|---|---|
| All 16 migrations apply cleanly, and re-applying them is safe | `npm run test:db` on a throwaway Postgres 16 with a Supabase stub | ✅ |
| RLS and permissions: students can't read answer keys or exam banks, edit balances, grant themselves access or roles, or call admin and server-only functions | `01_access_control.test.sql` | ✅ |
| Paid gating: Section C ≠ Section D; suspended accounts blocked | `01_access_control`, `04_publish_guards` | ✅ |
| Practice engine: counts 10/20/25/50/100, filters, randomised selection, immediate feedback, answers final, retry-mistakes, saved mode | `02_practice_exam_engine.test.sql` | ✅ |
| Exam engine: resume, server timer, late answers rejected, auto-submit at deadline, server scoring, review rules | `01`, `02` | ✅ |
| Credits: different costs, idempotent reservations, refunds on failure, no negative balance, plan quotas, rate limit, daily budget cap, monthly reset | `03_credits_payments_admin.test.sql` | ✅ |
| Concurrency: 20 simultaneous AI requests on a 5-credit wallet → exactly 5 succeed | `run_local.sh` | ✅ |
| Payments: amount tampering rejected, duplicate webhooks don't double-grant, refunds revoke access | `03` | ✅ |
| Content workflow: versioning, review/publish, editors can't self-publish even via the API, full-text search | `03`, `04` | ✅ |
| Question validation, bulk import with duplicate detection, bank-isolated pools | `03` | ✅ |
| AI provider adapters, fallback, timeouts, prompt safety, output parsing; Paystack signature check; CSV; spaced repetition | `npm test` (36 tests) | ✅ |
| Every screen (46 routes × desktop + phone) renders without runtime errors or horizontal scrolling | Headless Chromium against a mock backend | ✅ |
| Key flows click through (AI panel, practice answer, exam submit, station, flashcards, import, admin editor, dark mode) | Headless Chromium | ✅ |

**Not verified here** (needs your accounts or a normal internet connection):
- `npm install` / `vite build` with the real packages. The sandbox couldn't reach the npm registry, so type-checking used local stand-ins for React's and Supabase's type definitions. Run `npm install && npm run typecheck && npm run build` first.
- Live calls to Anthropic, OpenAI, YouTube and Paystack. Adapters are unit-tested against recorded response shapes only.
- Supabase Edge Function deployment and a real Paystack test-mode purchase.
- Email delivery (confirmation and reset).

## Before you launch

- [ ] `npm install && npm run typecheck && npm test && npm run build` pass on your machine.
- [ ] Back up any existing database, then `supabase db push` to a **staging** project first.
- [ ] Create the first super admin (docs/SETUP.md §2) and assign roles to your team.
- [ ] Set all Edge Function secrets; **Admin → AI → Test provider** shows each one as configured.
- [ ] Choose final AI models after testing them with real NMCN-style test cases. Set the daily budget cap and spend limits in the provider consoles.
- [ ] Paystack **test mode**: buy C, D and an AI plan end-to-end; check the webhook events are processed; record a test refund.
- [ ] Set real AI plan prices (current values are placeholders).
- [ ] **Verify the official NMCN curriculum and exam format** (papers, question counts, timing, pass marks, viva/CAOSCE rules) and configure exams to match. Don't describe anything as official unless verified.
- [ ] Load only content you own or are licensed to use. Have **qualified nurses and midwives review** every note and question before publishing.
- [ ] Archive or remove all **demo** content (anything marked "Demo") on production.
- [ ] Custom SMTP for auth emails; set the Site URL and redirect URLs.
- [ ] Privacy policy and terms (Nigeria Data Protection Act 2023), refund policy, and a support contact. The app shows "not affiliated with NMCN" on sign-in; keep similar wording in your marketing.
- [ ] Turn on Supabase PITR backups; run a restore drill.
- [ ] Switch Paystack to live (key + **Settings → Payments → Live**) only after all the above.

## Known limitations and suggested next steps

- **Offline use**: the app needs a connection. Exam answers retry automatically after brief drops, but notes aren't cached offline yet. A service worker (PWA) is a good next phase.
- **Native apps**: this is a mobile-first web app that works on iPhone and Android browsers and can be added to the home screen. App-store apps would be a wrapper (e.g. Capacitor) later.
- **Highlights** match text inside a single paragraph; very long cross-paragraph highlights are saved but not painted in the text.
- **Retrieval** uses Postgres full-text search, which is fast and free. For very large libraries, consider adding vector embeddings (pgvector) for better matching.
- **AI cost estimates** depend on the per-action estimates or the token prices you enter; reconcile monthly with the provider invoices.
- **Speech features** (listen to notes, spoken viva practice) are not built yet.
- **Leaderboards and social features** were left out on purpose, to keep student data private. They can be added later with opt-in.
- **Scheduled jobs**: expired attempts are closed lazily when next opened, and monthly credits roll over on next use. That's correct, but if you want reminder emails or notifications at set times, add Supabase Cron jobs.
