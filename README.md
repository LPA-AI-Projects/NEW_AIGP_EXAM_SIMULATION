# AIGP Exam Simulation — Learners Point Academy

A self-serve practice simulation of the IAPP AIGP (Artificial Intelligence
Governance Professional) exam. Learners join with just a name and email and go
straight into a practice session of their own choosing — no waiting on a trainer
to start anything. Every answer gets immediate feedback with an explanation. At
the end, learners get a score, a badge, a downloadable report, and a downloadable
certificate. The trainer gets a live dashboard of everyone's progress, a full
answer key, per-learner grade overrides, and PDF exports — all updating in real
time as learners work.

## What's inside

```
server/            Node/Express backend
  server.js         entry point, session middleware, route mounting
  db.js             Postgres connection + schema (auto-created on first boot)
  examEngine.js     question bank helpers, per-mode question draw, grading
  questionBank.json 134 verified questions (see "The question bank" below)
  lib/
    email.js         SMTP sending (nodemailer), no-ops gracefully if unconfigured
    pdf.js            report, certificate, and compiled PDF generation (pdfkit)
  routes/
    auth.js           learner join (identity only), trainer login/logout
    exam.js            learner-facing: pick a mode, get question, submit answer,
                        result, own report PDF, own certificate PDF
    trainer.js          dashboard: participants, full-bank answer key, overrides,
                        PDFs, resend, reset
public/             Static frontend (plain HTML/CSS/JS, no build step)
  index.html          landing page, dual login
  mode-select.html    learner picks Full Mock / Domain Practice / Quick Drill,
                       and starts immediately
  exam.html           one question at a time, immediate feedback, elapsed timer
  results.html        score, badge, domain breakdown, report + certificate
                       downloads, "start another session"
  dashboard.html      trainer: live participant table (view-only), answer key,
                       grading, PDF exports, reset
  style.css           shared white/corporate theme
  assets/logo.png     Learners Point logo (placeholder — see below)
```

## The question bank

`server/questionBank.json` holds 134 questions, tagged to the current IAPP AIGP
four-domain exam blueprint (I–IV). These were extracted and cross-checked against
the source materials in an earlier phase of this project — 100 from the IAPP-style
practice exam (verified against its own answer key, domain-by-domain totals matched
exactly), 10 IAPP-style sample questions, and 24 from third-party exam-prep sources.
Nothing about the question content has changed; it's the same verified bank, just
wired into a live multi-user tool.

## How it works

- **Learner**: enters name + email → picks a mode (Full Mock Exam at 25/50/100
  questions, Domain Practice on one of the four domains, or a 25-question Quick
  Drill) → starts immediately. Each learner's questions are drawn independently —
  there's no single shared exam everyone takes together. Logging back in with the
  same email resumes an in-progress attempt exactly where it left off, or shows
  the last completed result if they've already finished.
- **Trainer**: logs in with a shared code, sees every learner's progress update
  live (polled every few seconds), can open any learner's full answer breakdown,
  override a specific question's grading (recalculates their score immediately),
  download that learner's report or the compiled report for everyone, resend a
  learner's report+certificate by email, view the complete answer key for the
  whole question bank, or reset all stored data to start a new cohort from a
  clean slate.
- **Scoring**: a raw score and percentage, shown with one of four badges (Gold /
  Silver / Bronze / Keep Practicing) and a short remark — not IAPP's official
  100–500 scaled score, which uses a formula IAPP doesn't publish.

## Running it locally

You'll need Node 18+ and a local Postgres.

```bash
npm install
cp .env.example .env
# edit .env: point DATABASE_URL at your local Postgres, set a SESSION_SECRET
npm start
```

Open `http://localhost:3000`. Trainer code is `2468` unless you change `TRAINER_CODE`.

## Deploying on Railway

1. Push this folder to a GitHub repo (or use Railway's CLI to deploy the folder directly).
2. In Railway, create a new project from that repo.
3. Add a **Postgres** plugin to the project — Railway injects `DATABASE_URL`
   automatically, the app picks it up with no extra config.
4. Set these environment variables on the service (Railway → your service → Variables):
   - `SESSION_SECRET` — any long random string (`openssl rand -hex 32`)
   - `TRAINER_CODE` — the code trainers will enter (defaults to `2468` if unset)
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — optional, see below
5. Deploy. Railway will run `npm start` automatically (see `railway.json` / `Procfile`).
6. Open the generated Railway URL — that's the same landing page you tested locally.

No Dockerfile is needed; Railway's Nixpacks builder detects the Node app automatically.

If you're redeploying this over a database from an earlier version of this app (the
one with a shared trainer-started session), the schema migrates itself automatically
on boot — the old `sessions` table is dropped and the `participants` table gets the
new columns it needs. No manual migration step required.

### Email

The app sends two kinds of email, each with both the detailed report and the
certificate attached: automatically to a learner when they finish, and on-demand
when a trainer clicks "Send Updated Report" after correcting an answer. Both go
through plain SMTP (`server/lib/email.js`), which means **any** provider works
without touching code — Gmail with an app password, Resend, SendGrid, Postmark,
Mailgun, etc. Just set the five `SMTP_*` variables above. If they're left unset,
the app runs completely normally — it just logs "would have sent…" and the
dashboard's resend button reports that email isn't configured yet, instead of
failing.

### The Learners Point logo

`server/assets/logo.png` and `public/assets/logo.png` currently hold a placeholder
copy of the logo from earlier work in this project. Replace both files (same
filename) with your preferred version whenever you have it — nothing else needs to
change; the web pages, the reports, and the certificates all read from these two
files.

## Design decisions worth knowing about

- **Every learner draws their own questions.** There's no shared, trainer-configured
  exam anymore — each person's queue is built the moment they click Start, based on
  the mode they picked. This means the trainer's dashboard is purely observational:
  it has no Start button and nothing to configure.
- **Reset deletes everything.** The "Reset All Data" button on the dashboard wipes
  every participant record outright — there's no "archive and start fresh" concept
  to preserve history, because there's no single session to retire. Download the
  compiled PDF first if you want to keep a cohort's results.
- **The answer key is the whole bank.** With no single shared exam, the dashboard's
  Answer Key shows all 134 questions grouped by domain, rather than just the
  subset one session happened to draw.
- **No blocking browser dialogs anywhere.** Every confirmation (like Reset) uses an
  in-page modal instead of `confirm()`/`alert()`. This isn't just a style choice —
  those dialogs can get silently swallowed in some embedded or sandboxed browser
  contexts, which was the root cause of an earlier "submit button doesn't do
  anything" report. Removed entirely, here and in the certificate/report downloads.
- **The timer counts up, not down.** It's informational (how long you've been at
  it), not an enforced countdown — the flow is self-paced immediate-feedback
  practice, not exam-conditions timing.
- **Question count is a target, not an exact guarantee.** A handful of questions
  are grouped in shared scenarios (2–4 questions about the same case study). The
  draw logic keeps those groups intact rather than splitting them, so the actual
  question count can land a question or two above what was configured.
- **Trainer access is a single shared code**, read from `TRAINER_CODE` rather than
  hardcoded, but it's still just a code with no per-user accounts, rate-limiting, or
  lockout. Fine for a supervised training context; worth strengthening (or putting
  behind a Railway private network / access list) if this is ever exposed somewhere
  less controlled.

## Recent changes (this build)

- **Free navigation during the exam.** Questions no longer have to be answered in
  strict order. A collapsible Question Navigator groups every question by domain,
  shows a live "X of N answered" count per domain, and lets you jump to any
  question by clicking its number. Previous / Next buttons move sequentially.
  Revisiting an already-answered question shows it locked, with your answer, the
  correct one, and the rationale — read-only, since it was already graded.
- **Explicit Finish, instead of auto-completing on the last question.** A
  "Finish & See Results" button is always available. If anything's unanswered, it
  shows an inline warning (not a browser popup) — "N questions unanswered, these
  count as incorrect" — with the choice to go back or submit anyway.
- **Elapsed timer no longer freezes.** It was being stopped on every "Next
  Question" click but only ever restarted on the very first question, so it froze
  solid from question 2 onward. Fixed; verified it keeps advancing across many
  question transitions in an automated test.
- **Submit and Start buttons now show "Saving…" / "Starting…"** immediately on
  click, instead of just disabling with no visible change.
- **Scenario and question now share one visual language.** Both get a tinted,
  left-accented card with an icon and label (blue "Scenario", teal "Question") —
  previously the question stem was just plain text sitting under a nicely styled
  scenario box.
- **Certificate feature removed entirely** — button, PDF generation, and the
  auto-email attachment. The individual report PDF (question-by-question, with
  rationale) is still generated and emailed/downloadable as before.
- **New: a learner's own answer review**, available any time after finishing —
  "Review My Answers" on the results page, with an All / Missed-only toggle and a
  detail view per question (your answer, the correct one, the rationale) with
  Previous / Next to step through them.

## What's been tested

Automated browser tests (trainer and multiple learners running simultaneously,
exercising single/multi-select/ordering questions, scenario clusters, Full Mock /
Domain Practice / Quick Drill, free navigation via the Question Navigator, the
Finish-with-unanswered warning, resume-by-email mid-exam at the exact question left
off, the live dashboard, grade overrides, resend, the review screen, and both PDF
types) all pass as of this build, run against a freshly installed copy of exactly
what's in this zip — new database, new `npm install`, nothing carried over from
the author's own dev environment. Email sending itself could only be tested in its
"disabled" state, since it needs real provider credentials — worth sending
yourself one test report after deployment to confirm formatting once SMTP is
configured.
