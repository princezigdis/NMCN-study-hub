# Viva Lab and CAOSCE Lab

Built inside the main app (additive; nothing existing was changed except nav links, error messages and the admin menu).

## Routes
Viva: `/viva`, `/viva/session/:id`, `/viva/report/:id`, `/viva/progress`.
CAOSCE: `/caosce`, `/caosce/library`, `/caosce/procedure/:id` (7 stages), `/caosce/lab`, `/caosce/questions`, `/caosce/exams`, `/caosce/exam/:id`, `/caosce/report/:id`, `/caosce/dashboard`.
Admin: `/admin/lab` (review and publish, viva marking editor, procedure builder, video upload, exams and questions, analytics).

## Access
Section C or D entitlement, a dedicated `viva`/`caosce` entitlement, or staff unlocks everything. Items marked "free preview" are open to every signed-in student.

## Marking (no AI needed)
Answers are marked on meaning, on the server. Text is normalised (British/American spelling, local words such as womb/uterus, fits/convulsion, afterbirth/placenta), lightly stemmed and compared with each key point and its accepted wordings, with typo tolerance. Tutors improve marking by adding accepted wordings per key point in Admin, Viva and Edit marking. The marking guide (key points, model answer, explanation) is always shown. In practice mode a student can tick "I said this in my own words" to claim a point. Mock mode hides feedback until the end.
CAOSCE procedure stations are marked on what the student writes against the checklist; this does not prove practical skill. Timing is server-authoritative.

## Tutor review
Nothing is visible to students until published. Publishing needs the `content.review` permission, and procedures need steps, a source reference and a reviewer name. Admin, Review and publish has "publish all" for viva and CAOSCE. Content written by the developer is marked "Draft - requires tutor review".

## Voice
Browser speech recognition (Chrome/Edge) and speech synthesis. No audio is stored. Falls back to typing.

## Subdomains (optional, later)
The app already switches on hostname: `viva.<domain>` and `caosce.<domain>` open their section at `/`.
1. Vercel, Project, Domains: add `viva.nmcnstudy.app` and `caosce.nmcnstudy.app` to the same project.
2. DNS: add CNAME records for `viva` and `caosce` pointing to `cname.vercel-dns.com`.
3. Supabase, Authentication, URL configuration: add both URLs to Redirect URLs.
4. Students sign in separately on each subdomain unless cookie-based session sharing is added later.

## AI (paused)
AI follow-up questions and open-ended evaluation are not built. The marking is provider-agnostic; `lab_ai_logs` is ready to record usage when a provider is chosen.

## Videos
Upload MP4/WebM (up to 50 MB) in Admin, Videos, or paste a link. Use real recordings by qualified instructors, with captions and transcripts.
