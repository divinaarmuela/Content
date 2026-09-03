# Project state — as at 3 September 2026

## Dashboard look — 3 Sep 2026

**What this was.** The owner said the dashboard looked basic and everything was
small. It now follows the approved mockup:
<https://claude.ai/code/artifact/a952d413-f53e-473f-ba18-fbee823ccedc>. A dark
ink sidebar, a cream page, big headings, colour-tinted cards, one calendar in
the rail.

**The contract: nothing changed except the look.** Every page kept its data,
its live listeners, its buttons, its API calls and its role rules. No route
moved, no permission changed, no words got more technical. If a page behaves
differently after this, that is a bug, not a decision.

**What changed:**

- **Tokens.** The colours, type sizes and radii live in `app/globals.css` under
  `.dbx` and in `tailwind.config.js` (`ink`, `cream`, `paper`, `surface`,
  `tint-*`, `accent-*`, `text-page-title`, `text-card-title`, and so on). Dark
  mode swaps the same names, so no page writes a colour of its own.
- **The shell.** `app/dashboard/ui/Shell.tsx` draws the sidebar, the top bar
  and the page frame for every dashboard page at once. `app/dashboard/layout.tsx`
  still owns the hooks and the whole access decision and hands the answer down.
- **The components.** `app/dashboard/ui/` — `PageTitle`, `TintCard`, `Stat`,
  `Chip`, `Lane`, `WorkCard`, `MiniCalendar`, `Timeline`, plus `tone.ts`, the
  one map from a row's state to a card tint and a chip colour. They are
  presentation only: props in, markup out. `app/dashboard/ui/README.md` says
  what each one is for and when to reach for it.
- **Every page.** Overview, Production, Editor, Scheduler, Clients, Leads,
  Bookings, Social (and its four child pages), Website, Team, Team activity,
  Reports, Notifications, Settings, AI Assistant, Audience, the item page, the
  shoot page and the dialogs all sit on the shell and use the components. None
  was redesigned from scratch — old cards, chips and buttons were swapped for
  the new ones.

**The client portal.** `app/client/**` and `app/portal/[token]/**` are wrapped
in `.dbx` and use the same `components/ui/*`, so they picked the new look up
without being touched. The ruling for now is to KEEP that — one look across
everything the client and the team both see — and the pass on 3 Sep found no
breakage at 1440 or 390, light or dark. **This is still the owner's call to
make**: if the portal should look like the marketing site instead of the
dashboard, say so and it gets its own tokens.

**The tracker page is out of scope.** `app/dashboard/tracker`, `app/api/tracker`
and `app/lib/tracker*.ts` are the owner's own working files and are not in
version control. The restyle deliberately left them alone, and the coverage
test names them as a carve-out rather than pretending they pass.

**Adding a page.** Two lines:

1. Start the page with `<PageTitle title="…" summary="…" />` — the title is the
   only thing that names the page on a desktop, because the shell's own header
   title is hidden above `md`. A page under a layout that already draws one
   (Clients detail, Scheduler, Settings, Production's three views) must not
   draw a second.
2. Build the body out of `app/dashboard/ui/` components — `TintCard` + `Stat`
   for a summary, `Lane` + `WorkCard` for a board, `Chip` for a fact. Take the
   colours from `tone.ts`; never write a raw colour class.

`tests/page-title-coverage.test.ts`, `tests/shell-nav.test.ts`,
`tests/tone.test.ts` and `tests/button-touch-floor.test.ts` hold all of the
above in place.


## Firebase Realtime Database — 3 Sep 2026

**Why.** A single route such as `app/api/production/batches/[id]` made 11
sequential Supabase calls, each ~370ms from Vercel — boards waited on that
chain, and "realtime" meant Inngest's realtime channel pushing a hint that
triggered a refetch, never the data itself. Firebase Realtime Database (RTDB)
fixes both: hot screens read straight off a live listener with no API hop at
all, and server routes read a whole table once per request through a
request-scoped cache instead of one round trip per row.

**What moved.** Every table, every route, every Inngest function, the browser
hooks, the join logic — all of it. Postgres/Supabase is gone from the
codebase; RTDB (project `test-agent-88a4c`) is the only data store. Existing
Postgres uuids were kept verbatim as RTDB ids; a handful of tables whose
Postgres key was composite or non-uuid (`team_user_clients`, `asset_versions`,
`client_brand`, `intake_templates`, `scan_mailboxes`, `asana_project_map`, …)
got a deterministic id instead — see `lib/db-types.ts` `NATURAL_KEYS`.

**The `/mdm` layout:**

```
/mdm
  /tables/<table>/<id>          one row per child, same column names as before
  /uniq/<table>/<field>/<key>   -> id, for fields that were UNIQUE in Postgres
  /live/<channel>               tiny "something changed" markers
  /meta/migrated_at             ISO timestamp of the import
```

Everything the app writes lives under `/mdm`. The Firebase project's
Firestore holds another app's data entirely and is never touched.

**Access layer.** Server code reads and writes through `lib/db.ts` —
`table<T>('name')` gives `get`/`list`/`insert`/`update`/`upsert`/`remove`, all
over the RTDB REST API with plain `fetch` (no `firebase-admin`). Reads inside
one request share a cache (`withRequestCache`) so a route that used to make
11 Supabase calls now makes 2–3 REST reads. Joins (the old
`select('*, clients(name)')` style) are `attachOne`/`attachMany` in
`lib/db-join.ts`. The browser reads live via `lib/db-client.ts`
(`useTable`/`useRow`/`useLive`, backed by the `firebase/database` web SDK) —
this is the only code that imports `firebase/*`.

**Realtime.** Inngest's realtime channel (`inngest/react`,
`app/inngest/channels.ts`, subscription tokens) is gone — Inngest itself
stays for cron and background jobs only. In its place, `announce()`
(`lib/live.ts`) writes a `{ ...hint, ts }` marker to `/mdm/live/<channel>`
with one REST `PUT`; browser hooks (`useProductionLive`, leads, brand,
intake, comments) listen on that node with `onValue` and refetch through the
same Clerk-guarded API they used before — messages are hints, never data,
exactly as before. **Hot screens go one step further and skip the refetch
entirely**, rendering straight from a live `useTable`/`useRow` listener: the
`/dashboard` overview cards, the Production board, Editor, Scheduler, the
item detail page and its comments drawer, and `/dashboard/leads`. Two browser
tabs on `/dashboard/production` now update the instant either one changes
something — no reload, no poll window to wait out.

**No more check-then-write.** Postgres's `UPDATE … WHERE status = <expected>`
optimistic-concurrency pattern has a direct RTDB equivalent: `table().claim()`
wraps a conditional PUT keyed to the row's current ETag
(`compareAndSet` underneath) — exactly one caller's write lands, everyone
else gets back the row that beat them, never a throw. The "I'll take this
one" claim button, the scheduling-seat claim, and every optimistic-concurrency
transition in `workflow.ts` all run on this.

**What was skipped or never existed.** `scan_runs` (23,652 rows) and
`asana_events` (17,078 rows) were deliberately left behind and start fresh —
neither is load-bearing history. `website`, `content_assets` and
`asset_clicks` never had Postgres tables at all; the code already treated a
missing table as empty, so RTDB just… is empty for them, no error.

**The backup.** `scripts/migrate-supabase-to-rtdb.mjs` (+ `migrate-core.mjs`)
did the one-shot copy and wrote a raw JSON export to
`parked/supabase-export-2026-09-03/` (gitignored) before writing anything to
RTDB. The Supabase project itself is untouched and left as a cold backup —
nobody has deleted it. Both migration scripts stay in the repo for the
record, but neither can run again once `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are gone from the environment (see below) — that
is deliberate, not a bug.

**Env vars.** Five `NEXT_PUBLIC_FIREBASE_*` vars replace the two Supabase
ones, in `.env.local` and in Vercel (production + preview):

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_DATABASE_URL
```

None of the five are secret — they are the public web config Firebase expects
in the browser bundle. `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` have been removed from both places.

**Security rules.** `database.rules.json` at the repo root is open read
everywhere under `/mdm`, with write granted on `tables`/`live`/`meta` and an
atomic claim rule on `/uniq` — the owner's explicit decision (raised and
accepted: no auth check happens at the database layer, only in the Next.js
API routes and Clerk gating). **The owner still has to paste this file into
the Firebase console** (Realtime Database → Rules) — committing it to the
repo does not deploy it.

**Follow-ups, not part of this move:**
- Signed Cloudflare Stream playback URLs — unchanged, still the open item
  described lower in this file.
- The dashboard's visual revamp (new shadcn skill pass) is a separate,
  later project — nothing about how the screens look changed here, only
  where the data comes from and how fast it arrives.

## Team activity — 27 Aug

`/dashboard/team/activity` answers the question the boards cannot: *who is
holding what, who is free, and what is late?* One sortable table — person,
what they hold (owned items, scheduling handed to them, shoots they are
planning, comments they were tagged in), due this week, overdue, five mini-bars
of this week's throughput (versions, submissions, approvals, schedulings, posts,
counted from `workflow_activity` on the Melbourne week) and a 14-day activity
sparkline. A row expands to that person's open work split by `whoseTurn` into
"Your turn" and "Waiting on others", each line linking to the item, with a
one-click reassign for managers (the existing owner PATCH). Above it sits the
Unassigned pool — the work-page scopes read as one question — so the page also
says who is free. Shaping is pure in `app/lib/team-activity-core.ts` (finished
is read from each overlay's own turn table, and due dates bucket on the
*client's* calendar, not the viewer's); the data comes from
`/api/team/activity/workload` — one level in, because `/api/team/activity` is
already the Asana rollup — scoped server-side: a super admin sees the team, an
account manager sees the people holding work on their clients, plus themselves.
The page is visible to account managers and above and grantable per person; the
Overview carries a small Team card naming the top three people behind.

## Video previews — 27 Aug

A .mov exported with its `moov` atom AFTER `mdat` (no "fast start") makes a
browser download the whole file — 184 MB — before frame one, which showed as a
player spinning forever; HEVC and ProRes .mov files never decode in Chrome or
Edge at all. `app/lib/video-probe-core.ts` reads the first 256 KB (ranged GET on
R2, `Blob.slice` for a local file) and answers both questions; the item page,
the portal carousel and the Files box now show a reason and a Download link
instead of a spinner, and the uploader warns the editor at export time —
warning only, never a block.

## Video previews now PLAY — Cloudflare Stream — 27 Aug

The reason card was honest but nobody could watch the cut. Camera video that a
browser refuses is now re-encoded by Cloudflare Stream and the player falls
back to that, so "it will not play" stops being an outcome.

The rule, in order: **the original wins whenever it can play.** A fast-start
H.264 mp4 is already the best version of itself — full quality, no extra hop,
and it plays before Stream has finished thinking about it. Only when the
256 KB probe says the browser will refuse the file does anything ask Cloudflare
for a copy. So an ordinary mp4 costs nothing and behaves exactly as before.

- `video_previews` — no SQL step: the table is created on first write.
  `source_url` is unique: the row is the claim, so the same 2 GB master is
  never encoded twice (Stream bills per minute *stored*).
- `app/lib/stream-core.ts` — pure: `previewStateFor` (play-native / play-stream
  / pending / failed), the Cloudflare URL family, `previewPatchFrom`, the
  signature parsing, the sweep diff. Tested in `tests/stream-core.test.ts`.
- `app/lib/stream.ts` — copy-by-URL (`POST /stream/copy`, Cloudflare pulls
  straight from the R2 public URL — the bytes never touch Vercel), the webhook,
  the poller, the sweep, the stats.
- Players use Cloudflare's **iframe embed**, not HLS in a `<video>`: `hls.js`
  is not a dependency and Chrome/Firefox will not play a manifest natively, so
  the alternative was "works on the Mac, black on the PC" — the exact failure
  this closes.
- Triggers: every version save, job-pack upload and intake submit asks via
  `after()`; the existing half-hourly cron sweeps for anything missed and polls
  rows still encoding after 2 minutes (webhook primary, poll backstop — no new
  Inngest function, so no re-sync needed, CLAUDE.md trap 5b); and the first
  person to open a stuck video starts its encode, which covers everything
  uploaded before this existed.
- **Originals are untouched.** The Drive mirror and Instagram posting keep
  using the R2 original, always.

### What the owner has to do

1. Enable **Stream** on the same Cloudflare account that holds R2
   (dash.cloudflare.com → Stream → it asks once).
2. Make an API token with **Stream:Edit** on that account, and set two env vars
   in Vercel (Production + Preview):
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_STREAM_TOKEN`
3. Optional but worth it — register the webhook so a ready encode is noticed in
   seconds rather than within 30 minutes. Copy the URL from
   Settings → Integrations → "Video previews", then:
   ```bash
   curl -X PUT -H 'Authorization: Bearer <STREAM_TOKEN>' \
     https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/stream/webhook \
     --data '{"notificationUrl":"https://app.mdmmarketing.com.au/api/stream/webhook"}'
   ```
   The reply contains a `secret` — set it as `CLOUDFLARE_STREAM_WEBHOOK_SECRET`.
   Without it, unsigned deliveries are accepted but can only ever tell us the
   truth slightly early (they must name a uid we already have a row for).

**With the env vars unset, everything behaves exactly as it does today** — the
reason card and the download link, no rows, no calls, and the build passes.

**Cost.** Stream is billed per 1,000 minutes stored per month plus per 1,000
minutes delivered. Only video the browser refuses is ever encoded, which is
camera .mov and client phone footage rather than the finished mp4s — so the
bill tracks raw footage, not the whole library. `deletePreview(sourceUrl)` in
`app/lib/stream.ts` removes an encode and its row when something is culled.

**Follow-up: signed playback URLs.** Previews are public with
`requireSignedURLs:false` today, so anyone who guessed a uid could watch one.
The R2 originals are already served from a public bucket, so this exposes
nothing new — it is a smaller door on an already-open one. Signing would need a
key, an expiry policy and a signer on every player including the portal, which
has no login at all; worth doing, not worth blocking this on.

Settings → Integrations has a "Video previews (Cloudflare Stream)" row with
ready / preparing / failed counts for the last seven days and a **Retry failed**
button (super admin).

## Uploads show real progress — 27 Aug

"Uploading 6 files…" was the whole of what an editor saw while a gigabyte of
footage moved, and that word is indistinguishable from a hung tab: no way to
tell moving from dead, which file is slow, or how long is left — and the only
available action, reload, is the one that destroys the upload.

The PUT is now an `XMLHttpRequest` rather than a `fetch`, because **fetch
cannot report upload progress** in any shipping browser. `xhr.upload.onprogress`
gives bytes, and `xhr.abort()` gives the cancel that was missing.

- `app/lib/upload-progress-core.ts` — pure and tested: EWMA rate smoothing
  (a raw XHR rate swings between 400 MB/s and zero, so an unsmoothed ETA is
  worse than none), ETA, the words, and a batch bar weighted **by bytes** so
  five 3 MB files beside a 1 GB one do not read as 83% done.
- `app/dashboard/uploadQueue.ts` is now the one store behind all three
  surfaces. Rows carry `{loaded, total, startedAt, rateBps, etaSec, status,
  abort, retry}`; still 4 in parallel; the file is streamed off disk and never
  read into memory (the probe reads its first 256 KB and no more).
- `processing` is a real state: between the PUT landing and the item PATCH or
  version POST returning, the bytes exist and nothing references them, so a
  green tick there would be a promise a refresh would break.
- With Stream configured, a video row stays quietly on "Preparing preview"
  after the tick until its encode is ready — same `previewStateFor`.
- The tray, the new-item dialog's Files box and the item page's Files and NEW
  VERSION zones all render `app/dashboard/UploadRows.tsx`: name · size · bar
  with % · "12 MB/s · 40 s left" · ✕ cancel · Retry with the reason, over an
  overall "3 of 6 files · 62%".
- Saving a version is blocked mid-transfer ("Waiting for the files…"): a
  version saved with four of its five slides is worse than one not saved.

## Instant post updates (Zernio webhook) — 27 Aug

The dashboard used to learn a post was live from `reconcilePublishedJobs`, which
runs every 10 minutes — so the board could say "Scheduled" about something
already on Instagram, and the scheduler had no live link to send the client.
Zernio now tells us the moment it happens.

**Endpoint:** `POST /api/social/webhook` (already registered; that is why it
keeps that path). `POST /api/zernio/webhook` is the same handler under the
provider-shaped name. **Register one, not both.** Both are public — the
signature is the authentication, not Clerk.

**What it does.** Every social feature that used to learn Zernio's state by
polling now hears it first, with the poll kept as the backstop.

| Event | What changes |
|---|---|
| `post.published` | job → `published` + permalink; `recordPublishOnItem` walks the item scheduled → published as the system actor ("Posted by Instagram"). Also asks Inngest for the post's first analytics read **10 minutes later** (`app/social.post.published` → `post-analytics-first-fetch`; the platforms return zeroes before that). |
| `post.failed` / `post.partial` | job → `failed` with the provider's reason. The item **stays Scheduled** — it is booked, it just did not go out. |
| `post.platform.published` | the per-platform live URL is written to `publish_jobs.permalink`, the matching `schedule_entries.live_url`, `post_analytics.platform_post_url` and `content_assets.post_url` — each `is(…, null)` guarded, so a link set by hand is never overwritten. Does **not** settle the job; the rollup owns that. |
| `post.tiktok.url_resolved` | same path, back-fill only. TikTok hands over its public URL minutes after it reports the post published. |
| `post.platform.failed` | job → `failed` with the platform's own words (`linkedin: Document too large`). |
| `post.cancelled` | job → `cancelled` with a note the posting card renders, plus a `workflow_activity` row on the item. The item stays Scheduled. |
| `post.scheduled` | confirmation only; nothing moves. |
| `account.connected` | `syncSocialAccounts` for that client immediately, so the posting card stops saying "no account connected" about a channel that now works. |
| `account.disconnected` | unchanged since 20 Aug. |
| `comment.received`, `message.*`, `reaction.received`, `conversation.started` | recorded in `webhook_deliveries`. The Inbox reads its conversations **live** from Zernio, so there is no local store to write into — instead the page polls `/api/social/activity` (one indexed local query) every 30s and only spends a real provider round trip when the log's timestamp moves. **The comment→DM automations run inside Zernio**, not here; we configure them through their API and must not evaluate them a second time. |
| `review.new` / `review.updated`, `lead.received` | a bell-only notification to the client's account managers (super admins if none assigned). Nothing more. A lead on a *client's* ad is deliberately **not** put into MD Media's own `leads` table. |
| anything else | one structured log line and a 200. Never a 4xx: a non-2xx is redelivered for ~51 hours and is still unrecognised every time. |

**Idempotency** is now `webhook_deliveries.provider_event_id` (unique) — an
INSERT that either wins or does not, with no check-then-write window. Every
handler is *also* independently idempotent (conditional UPDATE, or a
null-guarded back-fill), so an unmigrated log table degrades to the old
behaviour rather than to double-writes. A delivery about to be answered non-2xx
**releases** its claim, so the provider's retry is not mistaken for a duplicate.

The 10-minute reconcile, the half-hourly analytics sweep and loading the Inbox
on visit all stay exactly as they were: the webhook is the fast path, not the
only path.

### What the owner has to do

Either of these is a complete setup — the handler accepts both.

1. **The button.** Settings → Integrations → Social publishing →
   **"Enable instant post updates"** (super-admin only). It registers the URL
   with Zernio, generates the signing secret, and stores it encrypted.
   It now asks for the **whole** event list, and if a registration already
   exists for this endpoint — including one made by hand, matched on host and
   path rather than on an exact string, so a trailing slash or the
   `/api/zernio/webhook` spelling still counts — it **PUTs that one and unions
   the events in** rather than creating a second registration. (Zernio allows
   50 webhooks and de-duplicates none of them: a second one means every event
   delivered twice, forever, with no error anywhere.) Requires
   `CREDENTIALS_KEY` (already set); no SQL step — `provider_webhooks` and
   `webhook_deliveries` are created on first write.
2. **By hand.** Add a webhook in the Zernio dashboard pointing at
   `https://app.mdmmarketing.com.au/api/social/webhook` (the card has a **Copy
   webhook URL** button), subscribed to every event in `ZERNIO_WEBHOOK_EVENTS`
   (`app/lib/zernio-webhook-core.ts`), with a secret of your choosing — then set
   that same value as **`ZERNIO_WEBHOOK_SECRET`** in Vercel (all environments)
   and redeploy. Pressing the button afterwards will find and extend that
   registration rather than duplicate it.

The Integrations card no longer claims "instant updates on" merely because a
registration row exists — it reads `webhook_deliveries` and says
*"Instant updates: on · last delivery 2 min ago · 14 events today"*. A webhook
pointed at a stale URL, or auto-disabled by Zernio after ten consecutive
delivery failures, used to look identical to a working one.

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
Drive has the whole archive. No SQL step: `drive_files` is created on first write.

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
  encrypted in `drive_connection` — no SQL step, the row is created on connect.

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
| clients → Brand tab | Live — brand guidelines PDF scanned once by Haiku into a structured profile (fonts, colours, voice, rules); no SQL step, `client_brand` is created on first write |
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

Firebase Realtime Database, as of 3 Sep 2026 — see the section at the top of
this file. No SQL step for anything: `scan_settings`, `scan_mailboxes` and
every other table listed here are created on first write. The historical
column shapes this section used to point at now live at
`docs/schema-history/*.sql`, read only by `scripts/gen-db-types.mjs`.

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

### Env vars — verified against Vercel on 1 Aug 2026, updated 3 Sep 2026

The Vercel account is the team **`md-media`** and the project is **`content`**
(production URL `https://www.mdmmarketing.com.au`). Not `lxuuryy`.

All required vars are now set. Confirmed present, on production + preview:

```
NEXT_PUBLIC_FIREBASE_API_KEY   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID   NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_DATABASE_URL
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
2. No SQL step — confirm the Firebase rules file has been pasted into the
   console (see the top section of this file) instead.
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
9. Superseded by the 3 Sep 2026 move to Firebase Realtime Database: no
   migrations are pending anywhere — every table, `client_brand` included, is
   created on first write.
