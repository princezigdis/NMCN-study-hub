# Admin guide

The admin console (`/admin`) is where you run the whole platform. Which menu items you see depends on your role. Every action is checked again on the server.

## Roles

| Role | Can do |
|---|---|
| Super admin | Everything: roles, settings, AI configuration, audit log |
| Content admin | Curriculum and notes (write **and** publish), content reports |
| Question admin | Write and import questions. Publishing needs a reviewer. |
| Reviewer | Clinically review and publish notes and questions |
| Exam admin | Sections C and D: exams, papers, pools, viva and CAOSCE stations |
| Support | Student accounts, complimentary access, credits, tickets, announcements |
| Finance | Payments, refunds, prices |

## 1. Build the curriculum (Curriculum & notes)

1. **Curriculum versions**: record which official curriculum each programme follows (label, source document, effective date).
2. **Courses**: add the course code, title and level, then tick **RN**, **RM** or both. Shared courses are stored once and shown to both programmes.
3. Inside a course, add **modules**, then **topics**, then optional **subtopics**. Use the ▲▼ arrows to reorder.
4. Use **+ Note** on a topic to create a study note or handout. This opens the editor.

### Writing and publishing a note

* Write in **Markdown** with live preview: `## Heading`, `**bold**`, lists, tables (`| a | b |`) and `> callout` boxes.
* **Insert image** uploads to private storage and inserts it into the text. **Attachments** (PDF/DOCX/PPTX) can be view-only or downloadable.
* Fill in **Source / reference** and **Change summary**, then **Save draft** and **Submit for review**.
* A **reviewer** checks the clinical content, sets the next review date, and chooses **Approve & publish** or **Reject** (with a reason). Students only ever see the approved, published version.
* Editing a live note creates a **new draft version**. Students keep seeing the old version until the new one is approved. **Version history** lets you view or **restore** any earlier version.
* **Preview as student** shows exactly what students will see.
* To remove content, set it to **Unpublished** (hidden) or **Archived** (retired). Only never-published drafts can be deleted.

## 2. Questions

### One question at a time (Questions → New question)

* Choose the **bank**:
  * **Practice**: Section B, free for all students.
  * **Section C pool**: mock exams only.
  * **Section D pool**: final simulator only, never mixed with C.
* Pick the course, topic, difficulty and programme (RN / RM / both), plus an optional clinical scenario and image.
* For **each option**, write the text and a **rationale**. The correct option explains *why it is right*; each other option explains *why it is wrong*. Students see all of these after answering.
* While you type, possible **duplicates** are flagged.
* **Save draft** → **Send to review** → a reviewer clicks **Approve & publish**. The server refuses to publish a question that doesn't have exactly one correct answer, a rationale for every option and a programme.
* Every save is versioned. **Change history** shows past snapshots.

### Bulk import (Bulk import)

1. **Download template** and fill it in Excel or Google Sheets (one row per question). Save as **CSV UTF-8**.
2. Upload it. Each row is checked instantly (missing answers, bad letters, duplicates within the file, missing rationales).
3. Click **Check on server (dry run)** to confirm topics exist and to detect duplicates against the existing bank.
4. Click **Import** (as Draft or In review; reviewers may import straight to Published). Bad rows are reported and skipped. Good rows are still imported.
5. **Export CSV** on the Questions page downloads any filtered set in the same format, for offline review or backups.

Only import questions you wrote or are licensed to use. Don't upload confidential official exam questions.

## 3. Mock and final exams (Exams)

1. Create **pools** for Section C and Section D separately, then add published questions from the matching bank (**Pools → Add**).
2. Create an **exam configuration** (title, instructions, programme, max attempts), then add **papers**:
   * Papers 1–3: **Objective**. Pick a pool, the number of questions drawn per attempt, the time limit, an optional practice pass mark, whether students can review answers after submitting, and whether to shuffle options.
   * Paper 4: **Viva** or **CAOSCE**. Attach stations from **Viva & CAOSCE**.
3. **Preview** starts a real attempt as you (admins don't need to pay), so you can test timing and marking.
4. Set the configuration to **Published** when ready.

Confirm the official paper structure, question counts, timings and pass marks against current NMCN guidance before publishing. The defaults are only examples.

### Viva and CAOSCE stations

Each station has a scenario, candidate instructions, and examiner notes (revealed after the attempt). A station can include a **procedure checklist** (points, with critical steps marked), **viva questions** with a marking guide, or both. Students answer, see the marking guide, self-assess, and can request AI practice feedback. Stations in the *practice* bank are free. Section C/D stations require that section's access.

## 4. Prices and access

* **Payments → Exam prices**: Section C / Section D prices and how many days access lasts.
* **AI & plans → Plans & pricing**: monthly credits, price, period, and diagram/web/video limits for Free, Standard, Pro and Ultra.
* **AI & plans → Credit costs**: credits per AI action. A short summary should cost less than a long explanation, and much less than a diagram.
* **Users → (student)**: grant, extend or revoke **complimentary access** to C or D, grant a complimentary AI plan, or adjust credits. Each action needs a reason and is written to the audit log, separate from real payments.

## 5. Students and support

* **Users**: search by name or email. Open a student to see their profile, access, payments, AI usage and tickets.
* **Suspend / Reactivate** blocks or restores sign-in immediately (a reason is required).
* **Send password reset** emails the student a secure link. Admins never see passwords.
* **Reports & support**: students flag incorrect notes, questions or AI answers. Mark a report *Reviewing*, fix the content, add reviewer notes, then *Resolve* it. Answer support tickets here; the student is notified.
* **Settings → Send an announcement** notifies all students, or only RN or only RM students.

## 6. AI management

* **Provider & budget**: switch provider or models, set a fallback, a **daily USD budget cap**, the per-user rate limit, maximum selection length and timeout, or turn AI off globally.
* **Test provider**: check that keys are configured and try a model before switching.
* **Usage & errors**: requests per day, failures (all refunded), credits used and estimated cost by action. Student-reported AI errors are under Reports.

## 7. Audit log

**Audit log** records who changed roles, access, prices, plans, credit costs, settings, feature flags and refunds; who published or rejected content; imports; credit adjustments; suspensions; and password-reset emails. The before and after values are kept. Entries can't be edited or deleted.
