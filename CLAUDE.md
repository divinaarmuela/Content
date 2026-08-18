# MD Media — Agency OS

Next.js app that is five things at once: the public marketing site, a CMS for that
site, an internal production-workflow dashboard, a client portal, and an automated
lead-capture pipeline.

**Read `docs/PROJECT_STATE.md` first** — it holds current status, what is live vs
demo data, the Clerk auth plan, and the deployment checklist. This file covers how
the codebase works and the traps in it.

## Stack

| | |
|---|---|
| Framework | Next.js 16 App Router, React 19, TypeScript strict |
| Styling | **Tailwind v3.4** — NOT v4 |
| Components | shadcn/ui **classic (Radix-based)** |
| Data | Supabase (Postgres + Storage) |
| Auth | Clerk 7 |
| Scheduling | Inngest v4 |
| AI | `@anthropic-ai/sdk`, `claude-haiku-4-5` for email classification |
| PDF | pdfkit |
| Tests | vitest |

## Commands

```bash
npm run dev        # dev server
npm run build      # production build
npm test           # vitest run — 58 tests, all must pass
npx tsc --noEmit   # type check
```

Before claiming any work is done, all three of `npm test`, `npx tsc --noEmit`,
and `npm run build` must pass. Do not report completion on tests alone.

## Traps — every one of these has already cost a day

1. **Tailwind is v3.** Never install a shadcn component in the `base-nova` /
   Base UI style — it targets Tailwind v4 and compiles to nothing, silently. The
   components render but are completely unstyled and non-functional. Use classic
   Radix shadcn only.
2. **Marketing CSS vs dashboard CSS.** `app/globals.css` styles the marketing site
   globally (`nav`, cream backgrounds, mono type). The dashboard is scoped under
   `.dbx` with a preflight wrapped in `:where()` so it has zero specificity and
   does not leak back out. Adding a bare element selector to globals.css will break
   the dashboard.
3. **Dark mode needs an elevation scale.** `--popover` lighter than `--card`
   lighter than `--background`. Dialogs/sheets/dropdowns must point at
   `bg-popover`, or they vanish into the page in dark mode.
4. **Inngest v4 puts triggers inside the options object**, not as a third argument:
   ```ts
   inngest.createFunction(
     { id: 'x', triggers: [{ cron: 'TZ=Australia/Melbourne */15 6-22 * * *' }] },
     async ({ step }) => { … }
   )
   ```
5. **pdfkit needs `serverExternalPackages: ['pdfkit']`** in `next.config.ts` or it
   throws `ENOENT … Helvetica.afm` at runtime.
5b. **A NEW Inngest function does nothing until the app is re-synced.** Deploying
   it is not enough: Inngest Cloud only knows the functions it discovered at the
   last sync, so `inngest.send()` for an unknown event succeeds and is then
   dropped — no run, no error, nothing in the dashboard. Cost half an hour on the
   brand scanner. After deploying a new function:
   ```bash
   curl -X PUT https://app.mdmmarketing.com.au/api/inngest   # {"modified":true} = it registered something new
   ```
   Installing Inngest's Vercel integration makes this automatic on every deploy.
6. **The vitest config must be `vitest.config.mts`** (`.ts` throws ERR_REQUIRE_ESM).
   `server-only` is aliased to a stub there.
7. **`app/lib/supabase.ts` builds its client at module load** with non-null
   assertions. Missing env vars throw at import time, which fails the *build*, not
   just the request.
8. **Route protection is an explicit allowlist** in `middleware.ts`. Everything not
   listed is public. `/api/submit` (the contact form) must stay public;
   `/api/leads` must not.

## Layout

```
app/
  page.tsx, marketing/, content/, branding/, …   public marketing site
  services/ about/ journal/ events/ work/        content pages (CMS-driven)
  dashboard/                                     internal app  (Clerk-gated)
  client/                                        client portal, logged in
  portal/[token]/                                client portal, no login
  (auth)/                                        sign-in / sign-up
  api/
    submit/          PUBLIC — contact form
    leads/           gated — lead list, edit, delete
    website/ team/ production/ ingest/ reports/  gated
  lib/
    workflow-core.ts   pure state machine, no I/O — test this
    workflow.ts        performTransition, optimistic concurrency
    gmail.ts           3 auth modes: delegated / refresh token / Clerk token
    email-lead.ts      inbox → Haiku → leads pipeline
    lead-enrichment.ts autoIngestLead — verified company becomes a client
    report-pdf.ts      monthly leads PDF
    clerk-gmail.ts     per-user mailbox access via Clerk
  inngest/functions.ts scheduled jobs
supabase/*.sql         idempotent migrations, run by hand in the SQL editor
docs/BUILD_PLAN.md     the governing plan
docs/PROJECT_STATE.md  current status — read this
```

## Conventions

- **Business logic lives in pure functions** (`workflow-core.ts` is the model:
  no I/O, fully unit-tested). Wrappers do the database work.
- **Race conditions are designed out, not retried around.** Three patterns in use:
  unique-constraint claims (`email_ingest_log.gmail_message_id`), optimistic
  concurrency (`UPDATE … WHERE status = <expected>`, zero rows means someone beat
  you), and append-only version numbers. Never "check then write".
- **The service-role key is server-only.** Every table is RLS deny-by-default;
  browser code never touches Supabase directly.
- **Authorization is enforced server-side**, in the API route. Hiding a button is
  presentation, not security.
- Prefer editing an existing page over adding a parallel one. Pages still on
  sample data are badged "Demo data" — keep that honest.
