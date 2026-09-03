# MD Media — Platform Build Plan

Prepared 31 Jul 2026 · Governs the build of both dashboard initiatives.
Source specs: `DASHBOARD_WORKFLOW_SPEC.txt` (client + team production workflow) and
`mdm-team-activity-dashboard-brief.pdf` (team activity / Asana).

---

## 0. One platform, three products

Everything ships inside the existing Next.js app (`Content/`), sharing one Firebase
Realtime Database (everything under `/mdm`), one Clerk auth system, and one design
system (shadcn, light/dark):

| Product | Spec | Users | Status |
|---|---|---|---|
| Website + CMS | — | Public + admins | **Live** (schema pending SQL run) |
| Production Workflow Dashboard | doc 1 | Team + clients | To build |
| Team Activity Dashboard | doc 2 | Team only | To build (phase 1 first) |

Shared foundations: `clients` master table, role system, activity/audit logging,
the dashboard shell.

---

## 1. Identity, roles, and adding people

### 1.1 Principles
- **People log in, mailboxes don't** (with the super-admin allowlist as the sanctioned
  exception below). A shared mailbox as a login breaks the audit trail; the specs
  require knowing *who* approved/changed things.
- **Role lives on the identity** (Clerk `publicMetadata`), not on the email domain —
  contractors on personal emails get the same treatment as staff.
- **Client visibility is a filtered view of the same backend**, never a second system.

### 1.2 Role model (superset covering both dashboards)

| Role | Production dashboard | Activity dashboard | Website CMS |
|---|---|---|---|
| `super_admin` | Everything + user management + commitments config | Sees everyone | Full |
| `account_manager` | Assigned clients; gatekeeper (review, send-to-client, approve-for-scheduling) | Own data + client view | — |
| `editor` | Assigned items; upload/submit/revise; never sees client comments | Own data + client view | — |
| `scheduler` | Only `approved_for_scheduling` onwards | Own data + client view | — |
| `client` | Their own filtered portal only | — | — |

Doc 2's `admin`/`member` maps onto this: `super_admin` = admin; every internal
role = member (own data + client-cut view). No separate role system.

### 1.3 Super-admin bootstrap (per Akmal, 31 Jul)
Environment-configured allowlist — on sign-in, a server check promotes these to
`super_admin` automatically:

```
SUPER_ADMIN_EMAILS=yusuf@mdmmarketing.com.au,tech@mdmmarketing.com.au,hello@mdmmarketing.com.au,contact@mdmmarketing.com.au
```

⚠️ Recorded caveat: `hello@` and `contact@` are shared mailboxes. Anyone with mailbox
access holds super-admin. Recommended hardening (not blocking): treat them as
break-glass accounts, and give Divina/Martin/Abby personal logins for daily use so
the audit trail stays personal.

### 1.4 How people get added (the flow)
1. **Team**: super_admin opens Dashboard → Settings → Team → "Invite". Enters email +
   role (+ assigned clients for AM/editor, + employment type and timezone for the
   activity dashboard). Clerk sends the invite; on first sign-in the server stamps
   role/metadata from the pending invite record. Google SSO for @mdmmarketing.com.au;
   email link/password for contractors on external addresses.
2. **Clients**: AM/super_admin opens a client in the registry → "Invite client user".
   Invite carries `role=client` + `client_id`. On sign-in they land in `/client`,
   scoped to their brand only. Multiple users per client supported (`client_users`).
3. **Removal/role change**: same Team screen; deactivation revokes Clerk sessions and
   flips `active_status` — history is preserved, access ends.

Backing table `team_users` (mirrors Clerk, adds what Clerk shouldn't hold):
`user_id, clerk_user_id, name, email, role, employment_type (employee|contractor),
assigned_client_ids, timezone, workday_start, workday_end, asana_user_gid,
active_status, notification_prefs`.

### 1.5 Enforcement
All authorization checks live in API routes (server-side), keyed off Clerk session →
`team_users`. RLS stays deny-by-default with the service key used only server-side.
UI hiding is a courtesy, never the control.

---

## 2. Production Workflow Dashboard (doc 1)

### 2.1 Schema (new tables, all FK → existing `clients`)
`monthly_commitments`, `batches`, `content_items` (9-status enum), `asset_versions`
(append-only versions), `comments` (`visibility: internal|client`, assignable,
resolvable, optional video timestamp), `approvals`, `schedule_entries`,
`notification_log`, `activity_log` — the doc's §9 model.

**Deviation from doc §16 Q1 (decided by Akmal, 31 Jul): direct file upload IS in
Phase 1.** Hybrid media model per `asset_versions`:
- `file_url` — direct upload to Cloudflare R2 (reuses the CMS upload pipeline;
  ~200MB cap; upload progress UI). Renders inline (video player / image lightbox)
  in team dashboard and client portal. This is the primary review surface.
- `dropbox_url` — internal master/archive (multi-GB raws stay out of app storage).
  Never client-visible.
- `drive_url` — optional client-facing fallback/alternative link.
- Submit validation: `file_url` OR `drive_url` required (reviewable asset must
  exist) + `dropbox_url` required (master must be archived).
- Old versions stay playable in history (side-by-side v1 vs v3 review).
- Later guardrail: storage lifecycle rule to archive superseded unapproved versions.

### 2.2 State machine (the heart)
One server module owns transitions:
`draft_uploaded → internal_review → (revision_required ⇄ revision_complete) →
client_review → (client_changes_requested → revision_required) →
approved_for_scheduling → scheduled → published`

- Transition validation server-side (illegal jumps rejected; submit blocked without
  Drive/Dropbox links).
- Every transition writes `activity_log` + fires the doc's notification map.
- Client-visible status is a translation layer (internal "revision_required" renders
  as "In production" for clients).
- Gatekeeper rules encoded, not conventioned: client comments notify AM only;
  scheduler queries are hard-filtered to `approved_for_scheduling+`.
- Per-client `client_approval_required` toggle (doc's suggested answer for seasoned
  clients).

### 2.3 Screens
Team side reuses the existing shell: Production board (existing kanban wired to real
data), Batch detail (bulk ops for 16–20 item shoots), Item detail (versions, comment
threads, handoff buttons), Scheduler queue (existing page wired + gated), Clients
(extend with commitments + client users), Notifications inbox, Activity log.
Client side: new `/client` area (middleware already protects it) — overview cards,
monthly commitment progress, calendar, needs-review with approve/request-change,
published links, AM message thread.

### 2.4 Order of work
1. Schema + `team_users` + roles/invites (§1) — foundation for everything
2. State machine + items/batches/versions APIs
3. Team board + item detail + comments/approvals
4. Scheduler queue gating + schedule/publish flow
5. Client portal
6. Notification log → in-app inbox (email digests = phase 2, per doc)
Acceptance = doc 1 §14 checklist run end-to-end with test users in every role.

---

## 3. Team Activity Dashboard (doc 2) — phase 1 only

### 3.1 Ingestion architecture (researched against Asana docs)
- **Webhook receiver** `/api/asana/webhook`: completes the `X-Hook-Secret` handshake,
  verifies `X-Hook-Signature` (HMAC-SHA256) on every delivery, ACKs fast (<10s) and
  processes async. Events are compact → hydrate details via API as needed.
- **Reconciliation worker** (cron): Asana delivery is *at-most-once*, and webhooks
  self-delete after 24h of failed delivery — so a sync-token `/events` poll per
  project runs periodically to backfill gaps and detect dead webhooks (heartbeats
  update `last_success_at`; the worker re-registers as needed).
- **Service account**: dedicated Asana seat (e.g. dashboards@) added to all projects;
  its PAT owns all webhooks (limits: 10k/token — no issue). Answered doc's Q1.
- **Event store**: `asana_events` (UTC timestamps, user gid, event type, task,
  project→client mapping via a `project_map` table). Raw + normalized; our own
  retention because Asana's history isn't queryable far back.

### 3.2 Phase 1 surface
One new dashboard page: **Rollup** — filter by date range + person; columns per doc
(completed, assigned/in-progress, overdue, last activity, event count). Admin sees
all; members see themselves (+ client-cut later). Timezone-correct display per
viewer; per-person working-day window stored in `team_users`. Employees vs
contractors visibly distinguished.

### 3.3 Non-negotiables carried from the brief
- No screenshots, keylogging, device agents, or anything invisible — not built, ever.
- Every member sees their own data; nothing too sensitive to show its subject.
- In-app transparency notice (what's collected, why, who sees it, retention) ships
  *inside phase 1*; written team notice + legal sign-off (Raween, Vizzone Ruggero
  Twigg) before rollout.
- Ship phase 1, run two weeks, then decide on the Today-timeline (phase 2).

### 3.4 Buy-vs-build note (doc's Q4, answered honestly)
Asana Universal Reporting / Screenful / Looker Studio connectors cover ~60–70% of the
rollup view but not: own event retention, per-viewer timezones + workday windows,
client-cut joined to our registry, or the future timeline view. Build is justified at
phase-1 size (~3–5 dev days); trialling Screenful first remains a legitimate option
if only the rollup matters.

---

## 4. Sequencing (recommended)

| # | Milestone | Why this order |
|---|---|---|
| 0 | Run `website_cms.sql`; fix service-role key; seed CMS | Unblocks what's already built |
| 1 | Identity layer: `team_users`, super-admin allowlist, invite flow, Team settings screen | Both dashboards depend on it |
| 2 | Production dashboard core (schema → state machine → team screens) | Highest day-to-day pain (doc 1's WhatsApp-chasing problem) |
| 3 | Client portal | Needs 2 to exist |
| 4 | Activity dashboard phase 1 (can run parallel to 3 — different tables/routes) | Independent ingestion work; legal notice gate before rollout |
| 5 | Notifications/digests (both docs' phase 2) | After the loops work manually |

Estimates: #1 ≈ 1–2 days · #2 ≈ 4–6 days · #3 ≈ 2–3 days · #4 ≈ 3–5 days.

## 5. Open items needing human action
- Superseded by the 3 Sep 2026 move to Firebase Realtime Database (see
  `docs/PROJECT_STATE.md`): no SQL step remains — tables are created on
  first write, and there is no service-role key to replace.
- Create the Asana service account + PAT when milestone 4 starts.
- Confirm the super-admin shared-mailbox caveat (§1.3) is accepted or hardened.
- Legal sign-off flow for the activity dashboard notice (§3.3).
