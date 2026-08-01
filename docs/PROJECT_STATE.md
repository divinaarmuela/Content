# Project state — as at 1 August 2026

Written so a fresh session can pick up without re-deriving anything. Update the
date and the sections below whenever the picture changes.

Companion docs: `../CLAUDE.md` (how the code works, traps), `BUILD_PLAN.md` (the
governing plan), `DASHBOARD_WORKFLOW_SPEC.txt` + the two client documents in this
folder (the source-of-truth specs for the production workflow).

---

## 1. Where things stand

**Nothing built after 30 July has been deployed.** Last push to
`divinaarmuela/Content.git` was `e0d6fa1`, 30 Jul 2026 21:24 — the marketing site
and contact form only. Everything since (dashboard, auth, workflow, portal, lead
ingest, reports) exists **locally and uncommitted**.

Verified green locally: `npm test` (58 passing), `npx tsc --noEmit`, `npm run build`.

### Dashboard pages

| Page | State |
|---|---|
| `/dashboard` (overview) | Live data |
| `leads` | Live — row actions, edit sheet, convert to client, delete |
| `clients` | Live — full contact records, editing |
| `website` | Live — CMS for site projects, media upload, ordering, publish |
| `production` | Live — board, item detail, transitions, comments, approvals |
| `scheduler` | Live — approved-content queue |
| `team` | Live — members, roles, client assignments, invites |
| `settings` | Live — report recipients, send day, data-from date |
| `calendar` | **Demo data** — next to wire, reads `schedule_entries` |
| `activity` | **Demo data** |
| `reports` | **Demo data** on the page; the PDF generator itself is real |
| `notifications` | **Demo data** — email notifications are real, this inbox is a mock |
| `ai` | **Demo data** |

Pages on sample data carry a visible "Demo data" badge. Keep that honest — do not
remove a badge until the page actually reads from the database.

### Backend

- **Workflow**: 9-status state machine (`app/lib/workflow-core.ts`), role gates,
  optimistic concurrency, full audit log. The AM-gatekeeper rule is enforced in
  code — client comments notify account managers, never the editor.
- **Client portal**: logged-in (`/client`) and tokenised read-only
  (`/portal/[token]`).
- **Lead ingest**: website form → lead; business domain + verifiable live site →
  auto-creates a "Prospect" client.
- **Inbox scanning**: Gmail API → prefilter → Claude Haiku → lead. Exactly-once via
  a unique claim on `gmail_message_id`. Currently one mailbox (`hello@`).
- **Monthly report**: branded PDF, configurable recipients/date, manual or scheduled.
- **Inngest v4**: inbox scan every 15 min (Melbourne time, 6am–10pm), daily report
  check. Chosen over Vercel Cron, whose free tier allows one job per day.

### Database

**`supabase/scan_settings.sql` is NOT yet applied anywhere** (added 1 Aug 2026).
Until it is run, the scanner settings API returns defaults and mailbox toggles
do not persist. Run it in the Supabase SQL editor before relying on the Inbox
scanner tab. It creates `scan_settings`, `scan_mailboxes` and `scan_runs`, and
widens the `email_ingest_log` status check to allow `needs_review`.

Migrations in `supabase/*.sql`, idempotent, applied by hand in the Supabase SQL
editor. Confirmed live: `clients`, `projects`, `assets`, `leads`, `team_users`,
`team_user_clients`, `team_invites`, `notification_log`, `email_ingest_log`,
`report_settings`. **Verify the `production.sql` and `portal_share.sql` tables
exist in the production project before deploying** — they were developed last and
may only be applied locally.

---

## 2. Clerk auth — the plan

### Now

Clerk 7 with **development keys** (`pk_test_` / `sk_test_`). Roles live in the
user's `publicMetadata` and are mirrored into the `team_users` table, which also
carries the many-to-many client assignments (`team_user_clients`).

Protection is an explicit allowlist in `middleware.ts`; anything not listed is
public. `clerkMiddleware` runs on nearly every route, so **missing Clerk env vars
take down the public marketing site too, not just the dashboard**.

`ClerkProvider` is deliberately scoped to `/dashboard`, `/client` and `(auth)` —
it is not in the root layout, so the marketing site carries none of it.

### Roles

| Role | Can |
|---|---|
| `super_admin` | Everything, including team management and settings |
| `account_manager` | Own assigned clients; the gatekeeper between client and editor |
| `editor` | Upload and submit content on assigned clients |
| `scheduler` | See approved content only; schedule and mark published |
| `client` | Own content only — approve or request changes |

Seeded from `SUPER_ADMIN_EMAILS`. Authorization is enforced in the API route, not
by hiding buttons.

### Steps to production auth

1. Create a **production instance** in the Clerk dashboard.
2. Add the DNS records Clerk supplies to the domain (`clerk.`, `accounts.`,
   `clkmail.` and two DKIM CNAMEs).
3. Swap the six Clerk env vars in Vercel to the `pk_live_` / `sk_live_` pair.
4. Sign in once as a `SUPER_ADMIN_EMAILS` address and confirm the role lands in
   `publicMetadata` and a `team_users` row is created.
5. Invite the rest of the team from `/dashboard/team`.

Development keys do work on a live domain, but with a dev banner, a 100-user cap
and no proper session handling on a custom domain. Acceptable for a team review,
not as the permanent state.

### Then: Gmail scope for per-user inbox scanning

Separate from sign-in, and only needed to scan mailboxes beyond `hello@`:

1. Google Cloud → OAuth consent screen → set publishing status **Internal**. This
   is what avoids CASA verification — `gmail.readonly` is a restricted scope and
   an External app would need a security assessment.
2. Create an OAuth client; put its ID and secret into Clerk as **custom
   credentials** for the Google connection.
3. Add the scope `https://www.googleapis.com/auth/gmail.readonly`.
4. `app/lib/clerk-gmail.ts` then supplies a fresh token per user on demand,
   including while they are offline, so scheduled scans cover every connected
   mailbox. Only `@mdmmarketing.com.au` addresses are ever scanned.

Alternative that needs no per-person action: a Workspace admin authorises
**domain-wide delegation** for a service account (`app/lib/gmail.ts` mode A).
`tech@mdmmarketing.com.au` is not a Workspace admin, so this needs someone else.

---

## 3. Deploying

The GitHub remote is **Divina's** (`divinaarmuela/Content.git`) and the branch is
`main`, so a push is a **production deploy on her Vercel project, at the live
domain**. There is no preview in that path. Do not push without saying so.

Access was the blocker; it is resolved. The project sits in the `md-media` Vercel
team, not `lxuuryy` (Akmal's). Do not create a project under Akmal's account; that
is the wrong target and has already been rejected once.

### Env vars — verified against Vercel on 1 Aug 2026

The Vercel account is the team **`md-media`** and the project is **`content`**
(production URL `https://www.mdmmarketing.com.au`). Not `lxuuryy`.

All required vars are now set. Confirmed present, on production + preview:

```
NEXT_PUBLIC_SUPABASE_URL   SUPABASE_SERVICE_ROLE_KEY
GMAIL_USER   GMAIL_CLIENT_ID   GMAIL_CLIENT_SECRET   GMAIL_REFRESH_TOKEN
NEXT_PUBLIC_ASSET_URL
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY   CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL       NEXT_PUBLIC_CLERK_SIGN_UP_URL
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL
ANTHROPIC_API_KEY   SUPER_ADMIN_EMAILS   CRON_SECRET
NEXT_PUBLIC_APP_URL   (production only — https://www.mdmmarketing.com.au)
```

The six Clerk vars were already there before this build was deployed. **They are
development keys** — confirmed 1 Aug 2026 by reading the deployed `/sign-in`
page, which inlines `pk_test_Z3JhbmQtZWZ0…` and points at the Clerk instance
`grand-eft-83.clerk.accounts.dev`.

**This is why signing in does not reach the dashboard.** A Clerk development
instance hosts its session on `*.accounts.dev`; that cookie cannot be shared
with `www.mdmmarketing.com.au`, so the redirect back from sign-in arrives
unauthenticated and bounces to sign-in again. It is not a bug in the app — it is
the expected behaviour of dev keys on a custom domain. Section 2 is the fix, and
it is now blocking, not optional.

`NEXT_PUBLIC_APP_URL` is production-only on purpose: it builds the links in portal
shares and report emails, and a preview deploy should not mint links pointing at
the live domain. Preview falls back to `http://localhost:3000`.

Still to add, but only **after** the first deploy: `INNGEST_EVENT_KEY` and
`INNGEST_SIGNING_KEY` (see below).

**Do not set `INNGEST_DEV`** in production; that flag makes Inngest look for a
local dev server. It exists in `.env.local` and was deliberately not copied up.

Keys belong in Vercel's environment settings, never committed. The repo is on a
GitHub remote that auto-deploys, so a hardcoded key is a published key.

### After the first deploy

1. Sync the Inngest app at `https://<domain>/api/inngest`, then add
   `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
2. Confirm the Supabase migrations above are all applied.
3. Sign in and confirm the super-admin role attaches.
4. Watch the first scheduled inbox scan — it creates **real leads** from live mail
   the moment it runs.

---

## 4. Next

1. Deploy + Clerk production instance (section 2 and 3). Everything else waits.
2. Extend inbox scanning past `hello@`. First check whether `contact@` and `info@`
   receive unique enquiries or only copies of website form submissions — if the
   latter, coverage is already complete and this work is unnecessary.
3. Wire `calendar` to real `schedule_entries`, then `activity`, then `reports`.
4. Monthly commitments — the portal shows progress against quotas, but there is no
   interface for an account manager to set them per client per month.
5. Content sign-off: Releeph, Alia, The Real Deal and Stretchworks case studies use
   placeholder images and draft copy; journal publish dates and event dates are
   provisional. Needs Divina's assets before the site is promoted.
6. Real in-app notification inbox; client-facing digests rather than instant email.
