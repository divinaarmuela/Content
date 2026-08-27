# Project state — as at 19 August 2026

## Instant post updates (Zernio webhook) — 27 Aug

The dashboard used to learn a post was live from `reconcilePublishedJobs`, which
runs every 10 minutes — so the board could say "Scheduled" about something
already on Instagram, and the scheduler had no live link to send the client.
Zernio now tells us the moment it happens.

**Endpoint:** `POST /api/social/webhook` (already registered; that is why it
keeps that path). `POST /api/zernio/webhook` is the same handler under the
provider-shaped name. **Register one, not both.** Both are public — the
signature is the authentication, not Clerk.

**What it does.** `post.published` → the job goes `published` with
`published_at` and the `platformPostUrl` permalink, then `recordPublishOnItem`
walks the item scheduled → published as the system actor ("Posted by
Instagram"), with the usual activity row and notifications. `post.failed` /
`post.partial` → the job goes `failed` with the provider's reason and the item
**stays Scheduled** — it is booked, it just did not go out. `account.*` →
unchanged. Anything else is logged and answered 200.

Idempotent by conditional UPDATE, not by an event table: a delivery only acts
if it moves a job out of `queued`/`publishing`/`scheduled`. Zernio is
at-least-once and retries for ~51 hours, so this matters. The 10-minute
reconcile stays as the backstop for deliveries that never arrive.

### What the owner has to do

Either of these is a complete setup — the handler accepts both.

1. **The button.** Settings → Integrations → Social publishing →
   **"Enable instant post updates"** (super-admin only). It registers the URL
   with Zernio, generates the signing secret, and stores it encrypted.
   Requires `CREDENTIALS_KEY` (already set) and one-off SQL:
   ```sql
   -- Supabase SQL editor, idempotent
   supabase/zernio_webhook.sql      -- creates provider_webhooks
   ```
2. **By hand.** Add a webhook in the Zernio dashboard pointing at
   `https://app.mdmmarketing.com.au/api/social/webhook` (the card has a **Copy
   webhook URL** button), subscribed to `post.published`, `post.failed`,
   `post.partial`, `account.disconnected`, with a secret of your choosing —
   then set that same value as **`ZERNIO_WEBHOOK_SECRET`** in Vercel (all
   environments) and redeploy. No SQL needed.

With neither, the endpoint answers 503 and refuses every delivery: an open
endpoint that can mark any client's post published would be worse than no
webhook at all.

## Client portal is mobile-checked — 27 Aug

`npm run check:mobile` loads the portal at 390×844 and 768×1024 (URLs from
`MOBILE_CHECK_URLS`, default the ZZ TEST share link) and fails on horizontal
overflow, tap targets under 40px tall or off-screen, text under 12px, and the
mode pill covering a control — screenshots land in `.mobile-check/`.

## Google Drive is now a mirror, not an index — 27 Aug

The folder tree below created folders and links. This fills them: **every file
that lands in our storage is copied into Drive**, so someone with nothing but
Drive has the whole archive. Run `supabase/gdrive_mirror.sql`.

**What goes where**

| The file | Lands in |
|---|---|
| A job-pack asset dropped on an item | `{Client}/…/{Item}/` — the item's own folder |
| A new version uploaded by the editor | the same folder, named `v3 - {their file name}` |
| The latest version, on **Approved for scheduling** | the shoot's `03 Final/` — or `{Item}/Final/` for a shoot-less item |
| The latest version, on **Scheduled** (and whenever a date is set or changed) | `{Client}/_Scheduled/{YYYY-MM}` — the month it **first** goes out |
| Files a client uploads through an intake form | `{Client}/_From client/{YYYY-MM-DD}` |
| Brand material — logos, fonts, a style guide — from intake **or** the brand-guidelines upload | `{Client}/_Brand/` |

- **Never mirrored: a pasted link.** A version whose only content is a Drive,
  YouTube or Vimeo URL has no file of ours behind it. Downloading one would
  store an HTML page under a video's name, so nothing is queued and nothing
  claims to have happened.
- **A month that changes MOVES the file.** Pushing a post from August to
  September re-parents it (`files.update` with add/removeParents) rather than
  copying it, so `_Scheduled/2026-08` stops claiming a post that is not
  happening then.
- **Nothing is ever uploaded twice.** `drive_files` has
  `unique (source_url, target)` and the row is claimed **before** the bytes
  move, so a retry either finds the job done or finds its own unfinished claim.
  Drive has no unique-name constraint, so without this a retried 2 GB transfer
  would leave two indistinguishable files.
- **Copy, not re-upload.** The approved cut is already in Drive from the item
  folder, so `03 Final` and `_Scheduled` are made with `files.copy` — one
  request that never leaves Google.
- **Resumable upload, always** — streamed from R2 in 8 MB chunks, so a 2 GB
  master never exists in memory. Drive's ceiling is 5 TB.
- **The item page** says `Mirrored to Drive · 7 files` or
  `Copying to Drive… 5 of 7` under the folder link, counted from `drive_files`.
  Clients never see it — the job pack is internal.
- **Drive not connected is a silent no-op**, logged once per process.

**Personal-email team members.** The domain share covers the agency's Workspace
and nobody else, so every active team member the domain grant does **not** cover
(the freelance editor on Gmail) gets a `writer` permission of their own on the
**root** folder and inherits down. Reconciled by `syncDriveMembers()` — given
nothing, computes everything, idempotent — on Drive connect, on every team
invite / role change / deactivation / removal, and from **Settings →
Integrations → Google Drive → Re-share with team** (super admin). Clients never
get a permission at any level, and a `.invalid` address is never shared with.

> **After deploying: re-sync Inngest.** `drive/mirror.file` is a NEW function,
> and Inngest Cloud only knows what it discovered at the last sync — until then
> `inngest.send()` succeeds and the event is dropped, with no run and no error
> (CLAUDE.md trap 5b). Every item page will read "Copying to Drive…" forever.
> ```bash
> curl -X PUT https://app.mdmmarketing.com.au/api/inngest   # {"modified":true}
> ```

**Not built, because there is nothing to build against:** the no-login portal
(`/portal/[token]`) has no upload of any kind — clients approve, request changes
and comment there, and that is all. The only route by which a client sends us a
file is the intake form, which is covered above.

## Google Drive — 27 Aug

Replaces the Dropbox integration built earlier the same day: same behaviour,
same folder shapes, Google instead. The Dropbox table and columns are dropped by
the migration below, because the Dropbox migration really was run on the live
database.

- **What it does.** Creating a shoot mints `{root}/{Client}/{YYYY-MM Title}` with
  `01 Raw`, `02 Edits`, `03 Final`; creating an item mints `02 Edits/{Reel 01 - Title}`.
  An item with no shoot goes to `{Client}/_No shoot/{Reel 01 - Title}` if it is a
  real deliverable, or `{Client}/_Tasks/{Title}` if it is internal work
  (research, strategy, copy). The item's folder link is prefilled from it. Hooks
  are fire-and-forget — Drive can never delay or fail a create.
- **No new environment variables.** It reuses the **Internal** Google OAuth app
  that already backs inbox and calendar connecting (`INBOX_CLIENT_ID` /
  `INBOX_CLIENT_SECRET`), and `CREDENTIALS_KEY` to encrypt the refresh token.
  All read lazily, so the build and the app work fine without them; the
  Integrations card just says "not configured".
- **Enable the API.** Turn on **Google Drive API** for the existing Google Cloud
  project (the one that owns the Internal OAuth client). Nothing else changes there.
- **Redirect URI** (add to the Internal OAuth client, exactly):
  `https://app.mdmmarketing.com.au/api/gdrive/callback`
- **Scope**: `https://www.googleapis.com/auth/drive.file`, plus `openid email
  profile`. `drive.file` is Google's *non-sensitive* per-file scope — no
  verification, no security review, and no read access to anything the app did
  not create.
  - **The consequence to know about.** A folder this app creates stays visible
    to it forever, but a folder that already existed is invisible to it and
    always will be. So a "Clients" folder already sitting in the Drive **cannot
    be adopted** — the app creates its own root, named by
    `drive_connection.root_name` (default `Clients`), and records its id in
    `root_folder_id`. To use a different name, set `root_name` before connecting.
- **Sharing.** A new folder is shared with the connected account's Workspace
  **domain** as writer, so everyone at the agency can open it and nobody outside
  can. If the account is a personal Google account (or the Workspace forbids
  domain sharing) no extra permission is granted at all — deliberately, rather
  than falling back to "anyone with the link", which would be a leak. The
  Integrations card says which of the two is happening.
- **Shared Drives** are supported: every call passes `supportsAllDrives`, so
  moving the root into a Shared Drive later keeps working.
- **Who connects.** A **super admin only**, from Settings → Integrations →
  Google Drive → Connect. There is one connection for the whole agency, stored
  encrypted in `drive_connection` (run `supabase/gdrive_connect.sql` first).

## Items with no shoot — 27 Aug

An editor may now create a content item with no shoot behind it, not just an
account manager — "sometimes we don't have a shoot brief and videos are edited
straight from the editor". The stated **reason stays required for everyone**
(supers included) and is logged on the item; schedulers and clients still cannot
create work at all. The New item dialog asks "No shoot — where is the footage
from?" and files the folder under `_No shoot`.

## Three pages (Production / Editor / Scheduler) — 26 Aug

- One board became three, each answering one question. **Editor**
  (`/dashboard/editor`) holds content items still in the making — everything
  before "scheduled". **Scheduler** (`/dashboard/scheduler`) holds signed-off
  items waiting for a posting time. **Production** (`/dashboard/production`)
  holds shoot briefs; a brief never appears on the Scheduler at all, and its
  end state is "Shoot booked", not "Published".
- **Scope pills** — Mine / Unassigned / All (`work-pages-core.ts`). Managers
  open on All, everyone else on Mine + Unassigned, so nobody scrolls past work
  that is plainly someone else's.
- **Claim** ("I'll take this one") is an `UPDATE … WHERE owner_id IS NULL` —
  or `WHERE scheduler_ids = '[]'` for the scheduling seat. Two people clicking
  at once is the normal case; the WHERE clause is the referee, never a read.
- **Rights follow assignment, not job title** (`actingRoles`): an AM who owns
  the edit may mark revisions done; an editor handed the scheduling may mark it
  scheduled and published; a scheduler handed nothing may do neither.
- **Redirects**: item detail lives at `/dashboard/production/<id>` and its
  "Back" returns to whichever page it came from (`backLinkFor`) — Production
  for a brief, Scheduler once approved, Editor otherwise.
- Proven live by `tests/e2e/assignment-roleplay.e2e.ts` (hats, brief booking,
  claim races, per-role visibility) alongside the original funnel roleplay.

## Latest: role-based build (19 Aug)

- **Realtime everywhere on production**: `productionChannel` (app/inngest/channels.ts)
  announces every item create / transition / version / comment / schedule; the
  board, scheduler queue, calendar, item detail, and Overview subscribe via
  `useProductionLive` and refetch instantly (60s visibility-aware poll as fallback).
- **Overview is per-role**: `/api/overview` shapes one payload per role; editors
  and schedulers now have `/dashboard` by default (page-access-core defaults).
- **Fixed a real notification bug**: the `team_users` embed on `team_user_clients`
  was ambiguous (two FKs) → PostgREST error → empty AM list → fallback emailed
  EVERY super admin on every transition. FK is now named explicitly in
  workflow.ts and the comments route.
- Scheduler can open Availability/Proposals (gcal + shoots GETs are scheduler+;
  editor-only controls hidden). Reports readable/downloadable by AMs.
- Settings and Audience tabs are child routes now — refresh keeps your place.
- **Live E2E role-play**: `npx vitest run --config vitest.e2e.config.mts` drives
  editor→AM→client→scheduler through the whole funnel against the
  "ZZ TEST - Workflow (do not touch)" client using `.invalid` test accounts.
  `EMAIL_TEST_ONLY=1` (set by the harness) makes the mailer refuse any real
  recipient — testing can never email actual team members.

Written so a fresh session can pick up without re-deriving anything. Update the
date and the sections below whenever the picture changes.

Companion docs: `../CLAUDE.md` (how the code works, traps), `BUILD_PLAN.md` (the
governing plan), `DASHBOARD_WORKFLOW_SPEC.txt` + the two client documents in this
folder (the source-of-truth specs for the production workflow).

---

## 1. Where things stand

**Everything is deployed and live in production.** The app runs on Vercel behind
`app.mdmmarketing.com.au` (marketing site on `www`), Clerk production instance,
auto-deploy on push to `divinaarmuela/Content.git`.

Verified green: `npm test` (230 passing), `npx tsc --noEmit`, `npm run build`.

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
| `ai` | Live — real agent (AI SDK 6 + Sonnet 5) over agency data: 10 typed tools, approval-gated edits, per-user chat history at `/dashboard/ai/[chatId]`, per-user behaviour + timezone, dictation |
| clients → Intake tab | Live — per-client intake forms: templates, editing, step UI, PDF+attachments email, submissions page, realtime progress |
| clients → Brand tab | Live — brand guidelines PDF scanned once by Haiku into a structured profile (fonts, colours, voice, rules); requires `client_brand.sql` |
| clients → Overview | Live — account-manager assignment card (any time, not intake-gated) |

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
  a unique claim on `gmail_message_id`. Three mailboxes (`hello@`, `contact@`,
  `tech@`), self-service OAuth connect (Internal Google app, `INBOX_CLIENT_*`),
  24/7 every 5 minutes, duplicate-client suppression, realtime lead toasts.
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

1. **Production workflow flow** — built but unused. Needs in-app draft uploads
   (`/api/production/items/[id]/versions` accepts URLs only) and a first real
   client run. Divina's stated next build.
2. Wire `calendar` to real `schedule_entries`, then `activity`, then `reports`.
3. Monthly commitments — the portal shows progress against quotas, but there is no
   interface for an account manager to set them per client per month.
4. Content sign-off: case studies still using placeholder images and draft copy;
   journal/event dates provisional. Needs Divina's assets before promotion.
5. Real in-app notification inbox; client-facing digests rather than instant email.
6. OG images for the marketing site — root layout has no `openGraph`/`metadataBase`
   and case pages have no `images`, so shared links have text-only previews.
   (Dashboard links now redirect to sign-in rather than 404 — fixed 8 Aug.)
7. Image optimisation on upload (no resizing/WebP today).
8. Rotate the two pasted Google client secrets (scanner + sign-in apps).
9. Migrations pending: `client_brand.sql` (awaiting run). `assistant.sql`,
   `intake*.sql`, `inbox_connect.sql` are applied.
