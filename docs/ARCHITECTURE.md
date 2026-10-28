# Architecture

## Overview

```
 Browser (React SPA, Vite)                    Supabase
 ┌──────────────────────────┐   anon key    ┌────────────────────────────────────────┐
 │ Student app  (A–E)        │──────────────▶│ PostgREST  →  Postgres (RLS on all     │
 │ Admin console (lazy-load) │   JWT         │                 tables + checked RPCs) │
 │ AI panel, exam room, …    │               │ Auth (email + password)                │
 └─────────────┬────────────┘               │ Storage (private buckets)              │
               │ functions.invoke            │ Edge Functions (Deno)                  │
               ▼                             │  ai-assist        → Anthropic / OpenAI │
        Edge Functions ─────── service role ─▶│  payments-*       → Paystack           │
                                              │  admin-users      → Auth admin API     │
                                              │  admin-ai-test                          │
                                              └────────────────────────────────────────┘
```

* **Frontend**: React 19 + TypeScript + Tailwind CSS 4, built with Vite. A small built-in router (`src/lib/router.tsx`) keeps dependencies minimal. The admin console is code-split, so students never download it.
* **Database**: every rule that matters runs in Postgres: scoring, timing, credit accounting, entitlements and publishing checks. The browser only gets the public anon key.
* **Edge Functions**: these hold every secret (AI keys, Paystack secret, service-role key). They are the only code that talks to AI providers and Paystack.

## Sections → code

| Section | Student screens | Server logic |
|---|---|---|
| A Study Library | `pages/library/*` | `note_reader`, `note_progress`, `search_notes`; RLS serves only the published version |
| B Question Bank | `pages/practice/*` | `practice_start/get/answer/finish`; answer keys are only returned after answering |
| C Mock exam | `pages/exams/*` (section C) | `exam_catalogue/start/get/save_answer/submit`, `station_*` |
| D Final exam | same screens, section D | same RPCs; separate `section_d` bank and pools; separate product |
| E Dashboard | `pages/dashboard/*` | `my_dashboard`, `my_topic_stats`, own-row tables (flashcards, goals, timetable…) |
| AI everywhere | `components/ai/*` | `functions/ai-assist` + `ai_reserve` / `ai_complete` |
| Payments | `pages/plans/*`, `components/Paywall.tsx` | `functions/payments-*` + `payment_fulfill` |
| Admin | `pages/admin/*` | `admin_*` RPCs (each checks permissions) + RLS write policies |

## Data model (migrations in `supabase/migrations`)

| Migration | Contents |
|---|---|
| 0100 foundation | enums, `programmes` (RN/RM), `profiles`, `user_roles`, `role_permissions`, permission helpers |
| 0200 curriculum | `curriculum_versions`, `courses` ↔ `course_programmes` (shared RN/RM content), `modules`, `topics` (+subtopics), `notes`, `note_versions` (versioned, full-text indexed), attachments, references |
| 0300 questions | `questions` (one **bank** each: practice / section_c / section_d), `question_options` (answer key + per-option rationale), `question_programmes`, `question_versions` (snapshots), `question_pools` (+ bank-matching trigger), publish validation |
| 0400 practice & exams | `practice_sessions/items`, `exam_configs`, `exam_papers`, `exam_attempts/items`, `clinical_stations`, checklists, viva questions, `station_attempts` |
| 0500 learning | bookmarks, highlights, personal notes, reading progress, flashcards (SRS fields), goals, timetable, activity log, notifications |
| 0600 AI credits | `app_settings`, `feature_flags`, `ai_plans`, `ai_action_costs`, `ai_subscriptions`, `credit_wallets`, `credit_ledger`, `ai_requests`, `ai_reserve`, `ai_complete`, `my_wallet` |
| 0700 payments | `products`, `payments`, `payment_events`, `refunds`, `entitlements`, `payment_fulfill` |
| 0800 audit | append-only `audit_logs` + triggers on sensitive tables, `content_reports`, `support_tickets` |
| 0900 student RPCs | reader, search, practice engine, exam engine, stations, dashboard, new-user bootstrap |
| 1000 admin RPCs | overview, reorder, note review workflow, question save/import/duplicates, users, access, credits, refunds, broadcast, AI usage |
| 1100 RLS | row-level security on every table, column-level grants, function privileges |
| 1200 storage | private buckets `content`, `question-images`, `ai-images` + policies |
| 1300 reference data | programmes, role permissions, products (₦1,500 / ₦5,000), AI plans (100/400/1,600/6,400 credits), action costs, settings, flags |
| 1400 AI retrieval | `ai_retrieve_notes` (grounding), viva feedback storage |
| 1500 publish guards | reviewers-only publishing (even via direct API), note live-version guard, profile FKs |
| 1600 admin extras | `admin_notify_user`, `admin_staff` |

`supabase/seed.sql` holds **demonstration content only** (flagged `is_demo`, titled "(Demo)").

## Security model

* **RLS everywhere.** Students read published content and their own rows. Answer keys (`question_options`) and exam-bank questions are never directly readable by students.
* **Writes that affect results go through `SECURITY DEFINER` RPCs** that check the caller. Students can't insert or update scores, attempts, wallets, ledgers, payments, entitlements or roles (privileges are revoked at the table level).
* **Time is server-side.** `exam_attempts.deadline_at` is set by the server. Late saves are rejected and expired attempts are auto-scored.
* **Roles → permissions.** Seven roles map to permissions in `role_permissions`. `has_permission()` is used by RLS policies and RPCs. Hiding admin buttons in the UI is a convenience, not the protection.
* **Publishing requires review.** Triggers stop anyone without `content.review` / `questions.review` from publishing, even through the REST API. A note's live version must be an approved version.
* **Audit.** Changes to roles, access, subscriptions, prices, plans, costs, settings, flags, refunds and exam configs are logged automatically. Custom events (publish, import, credit adjustments, broadcasts, suspensions, password-reset emails) are logged too. The log is append-only.
* **Secrets.** AI keys, the Paystack secret and the service-role key exist only as Edge Function secrets. `app_settings` stores model names and budgets, never keys.
* **Uploads.** Buckets are private, with MIME and size limits. Files are served by short-lived signed URLs.
* **XSS.** Markdown is rendered with `marked` and sanitised by DOMPurify, with no inline styles, iframes or forms. CSV exports neutralise formula injection.
* **Privacy.** The AI receives only the selected text, approved note excerpts and question or rubric content. No names, emails or IDs are sent.

## AI request flow (`functions/ai-assist`)

1. Authenticate the user, then validate the action, text length and IDs.
2. Check feature flags, then authorise the context. *Explain this question* only works for questions the student has already answered. Viva feedback only works on the student's own attempt.
3. `ai_reserve()` runs in one transaction with the wallet row locked. It checks the kill switch, the daily USD budget cap, the per-user rate limit, plan-allowed actions, image/web/video quotas and the balance. Then it deducts credits and writes the ledger. The idempotency key prevents double charges on retries.
4. Retrieval: `ai_retrieve_notes()` returns the note being read plus the best full-text matches among published notes. These are passed to the model as numbered `<study_material>` and come back as citations.
5. The provider is called through the provider-independent registry (`_shared/ai/registry.ts`), with a fast or strong model chosen per action. Each call has a timeout. On transient failures it falls back to a secondary provider, if one is configured.
6. `ai_complete()` records tokens, latency and estimated cost. **Any failure refunds the credits.**

Credit costs, plan allowances, models, budgets and limits are all editable in **Admin → AI & plans**.

## Payment flow (Paystack)

1. `payments-initialize` looks up the **server-side price** (`products` or `ai_plans`), refuses duplicate purchases and test/live key mismatches, creates a `payments` row with a random reference, and returns Paystack's hosted checkout URL.
2. After paying, Paystack redirects to `/payment/callback`. The page calls `payments-verify`, which asks Paystack's API directly.
3. Paystack also calls `payments-webhook`. The function verifies the HMAC-SHA512 signature over the raw body and stores the event once (keyed by sha256 of the body). It then re-verifies the transaction through the API.
4. Both paths call `payment_fulfill()`. It is idempotent, checks that amount and currency match the stored price, and creates exactly one entitlement or subscription per payment.

Section C and Section D are separate products. AI plans are separate from exam access.
