# NMCN Study

An exam-preparation platform for Nigerian **Registered Nursing (RN)** and **Registered Midwifery (RM)** students. It includes a student app, a full admin console, a Supabase backend and an AI study assistant.

| | Section | What students get |
|---|---|---|
| **A** | Study Library | Notes and handouts by course → module → topic, search, RN/RM filter, bookmarks, highlights, personal notes, reading progress, references, attachments |
| **B** | Question Bank | Sessions of 10/20/25/50/100 questions by course, topic, difficulty or programme; instant feedback with **why each option is right or wrong**; saved questions; retry mistakes; history and topic statistics |
| **C** | Mock Examination (₦1,500) | Timed Papers 1–3 (objective) with a server-side clock, autosave, resume, flagging, automatic marking, results by topic and answer review; Paper 4 viva and CAOSCE-style stations |
| **D** | Final Exam Simulator (₦5,000) | Separate question pools and configurations, full-length papers, weak-topic analysis and a readiness indicator (practice only) |
| **E** | My Dashboard | Progress, streaks, weak topics, goals, timetable, flashcards with spaced repetition, exam history, credits and access status, notifications |
| **AI** | Everywhere | Select text → explain simply or at exam level, summarise, expand, compare, flashcards, mnemonics, practice questions, diagrams, YouTube videos, follow-ups; deeper rationales after answering; viva feedback. Free / Standard / Pro / Ultra credits (100 / 400 / 1,600 / 6,400). |
| **Admin** | `/admin` | Curriculum, versioned notes with review workflow, questions (editor, CSV import/export, duplicate detection), exam and pool setup, stations, users and complimentary access, AI providers/plans/costs/budget, payments and refunds, reports and support, audit log, feature flags, announcements |

## Tech stack

React 19 + TypeScript + Tailwind CSS 4 (Vite) · Supabase (Postgres with Row Level Security, Auth, Storage, Edge Functions) · Paystack · Anthropic Claude (text) and OpenAI (images), switchable from the admin console · YouTube Data API.

## Quick start

```bash
npm install
cp .env.example .env.local        # add your Supabase URL + anon key
npm run dev
```

Then follow **[docs/SETUP.md](docs/SETUP.md)** to apply the database migrations, create the first admin, deploy the server functions, and connect AI and Paystack.

## Project layout

```
src/
  App.tsx, main.tsx, index.css    routes, entry, theme (light/dark)
  lib/                            supabase client, API wrappers, router, CSV, SRS, markdown, types
  auth/AuthProvider.tsx           session, profile, roles → permissions
  components/                     UI kit, app shell, AI assistant panel, question card, paywall
  pages/library|practice|exams|dashboard|plans|auth   student sections A–E
  pages/admin/                    admin console (code-split)
supabase/
  migrations/                     16 versioned, additive SQL migrations (schema, RLS, server logic)
  functions/                      Edge Functions: ai-assist, payments-*, admin-users, admin-ai-test
  functions/_shared/              provider-independent AI layer, Paystack, HTTP helpers
  seed.sql                        DEMO content only (never load into production)
  tests/                          SQL tests + local runner (throwaway Postgres)
tests/                            unit tests (node:test)
docs/                             architecture, setup, admin guide, launch checklist
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check + production build to `dist/` |
| `npm test` | Unit tests (CSV import, spaced repetition, AI prompts/providers, Paystack signatures, routing) |
| `npm run test:db` | Applies all migrations and the seed to a **temporary** local Postgres, then runs the RLS, scoring, credit, payment and publishing tests, including a concurrency test |
| `npm run db:push` | Apply migrations to your linked Supabase project (back up first) |

## Status

Built and tested so far: the database (4 SQL test suites plus a concurrency check), the unit tests (36), and a headless-browser pass over every screen on desktop and phone against a mock backend. **Still awaiting your setup**: Supabase project, Paystack keys, AI and YouTube keys, and a real `npm install` and build (the build sandbox had no npm registry access). See **[docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md)** for what's verified, what isn't yet, and what to do before launch.

## Content and compliance

* Content marked **Demo** is placeholder content, not verified NMCN material.
* Have qualified nurses and midwives review all clinical content. Upload only material you own or are licensed to use.
* This is an independent study platform. Don't present it as affiliated with or endorsed by the Nursing and Midwifery Council of Nigeria.

More: [Architecture](docs/ARCHITECTURE.md) · [Setup & operations](docs/SETUP.md) · [Admin guide](docs/ADMIN_GUIDE.md) · [Launch checklist](docs/LAUNCH_CHECKLIST.md)
