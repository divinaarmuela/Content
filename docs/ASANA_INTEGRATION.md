# Asana Integration — Build Guide

Goal: pull every employee's Asana activity into our dashboard (the **Rollup**
page from `BUILD_PLAN.md` §3) so work is visible in one place instead of inside
Asana. This doc turns that plan into a concrete build recipe, with the API
specifics pulled from Asana's developer docs (developers.asana.com, checked
2026-08-03). We are on a paid Asana plan, which matters for rate limits.

## 0. Accounts & credentials (human steps, do first)

1. Create a dedicated Asana service account (e.g. `dashboards@mdmmarketing.com.au`)
   with a seat on our plan, and add it to **every project** we want tracked.
   A member-level seat is enough; it must be able to see the projects.
2. Signed in as that account, create a **Personal Access Token**:
   Asana → Settings → Apps → Developer apps → Personal access tokens.
3. Env vars (local `.env.local` + Vercel):
   - `ASANA_PAT` — the token (server-only, never NEXT_PUBLIC)
   - `ASANA_WORKSPACE_GID` — from `GET /workspaces`
4. Fill `team_users.asana_user_gid` for each member (`GET /users?workspace=<gid>`
   lists gid + email; match on email).

Auth is a plain Bearer header: `Authorization: Bearer $ASANA_PAT`.

## 1. Architecture (webhooks + reconciliation, per BUILD_PLAN §3.1)

Two ingestion paths, because Asana's delivery is **at-most-once** — webhooks can
miss events, and the `/events` stream only holds **24 hours** of history:

```
Asana ──webhook──▶ /api/asana/webhook ──▶ asana_events (insert, dedup)
      ──poll────▶ Inngest cron (15 min) ─▶ /events per project (sync token)
                                          └▶ backfill misses + webhook health
```

### 1.1 Webhook receiver — `/api/asana/webhook`

Public route (add to the middleware allowlist, like `/api/submit`). Behavior,
per Asana's webhook guide:

- **Handshake**: on webhook creation Asana POSTs with an `X-Hook-Secret`
  header. Echo the same header back with `200`/`204`. The creation API call
  stays pending until the handshake completes — the route must be deployed
  and reachable *before* registration.
- **Store the secret** per webhook (`asana_webhooks.hook_secret`).
- **Verify every delivery**: `X-Hook-Signature` = HMAC-SHA256 over the **raw
  request body** keyed by the stored secret. Compare with a timing-safe equal;
  reject mismatches.
- **ACK fast**: Asana requires a success response **within 10 seconds** or it
  retries with exponential backoff for up to 24h. Insert raw events and return;
  hydration happens async (Inngest event, not inline).
- **Heartbeats**: empty `events: []` payloads at handshake and every ~8 hours.
  Treat as success, update `asana_webhooks.last_heartbeat_at`.
- **Self-deletion**: Asana deletes a webhook after 24h of failed deliveries,
  when the resource is deleted, or when the token is deactivated. Never assume
  a webhook is alive — the reconciler re-registers dead ones.
- Payload shape: `{ "events": [...] }`, compact events only (no full task
  data). Hydrate details with follow-up API calls when needed.

### 1.2 Reconciliation worker (Inngest cron, every 15 min)

For each mapped project:

1. `GET /events?resource=<project_gid>&sync=<stored_token>`.
2. First-ever call has no token → Asana answers **412 Precondition Failed**
   with a fresh token in the body. That's the baseline, not an error.
3. Insert any events the webhook missed (dedup makes this safe), store the new
   sync token. Tokens expire after ≤24h; on 412 mid-life, re-baseline and rely
   on the overlap window.
4. Webhook health: if `last_heartbeat_at` is older than ~9h, assume
   self-deleted → delete the row and re-register (fresh handshake).

Conventions note: dedup is a **unique constraint**, not check-then-write —
same pattern as `email_ingest_log.gmail_message_id`.

### 1.3 Rate limits (paid plan)

- **1,500 requests/min** per token (free would be 150; search API 60/min).
- Concurrency caps: 50 in-flight GETs, 15 in-flight writes.
- 429s carry `Retry-After` — honor it; rejected requests still burn quota.
- Cost-based limiting also applies: prefer `opt_fields` allowlists over deep
  nested expansions when hydrating.
At our scale (a dozen projects, ~15 people) none of this should bite; the
15-minute poll across all projects is a handful of requests.

## 2. Schema — `supabase/asana_activity.sql` (idempotent, run by hand)

```sql
-- Webhook registrations owned by the service-account PAT
create table if not exists asana_webhooks (
  id                uuid default gen_random_uuid() primary key,
  project_gid       text not null unique,
  webhook_gid       text,
  hook_secret       text,
  sync_token        text,           -- reconciliation baseline for /events
  last_heartbeat_at timestamptz,
  last_event_at     timestamptz,
  created_at        timestamptz default now() not null
);

-- Asana project → our client registry (the "client cut")
create table if not exists asana_project_map (
  project_gid  text primary key,
  project_name text not null default '',
  client_id    uuid references clients(id) on delete set null,
  tracked      boolean not null default true
);

-- Raw + normalized event store; our own retention (Asana keeps 24h)
create table if not exists asana_events (
  id           uuid default gen_random_uuid() primary key,
  -- dedup key: Asana events carry no gid, so hash
  -- (created_at, user_gid, resource_gid, action, change_field)
  dedup_key    text not null unique,
  created_at   timestamptz not null,          -- event time, UTC
  ingested_at  timestamptz default now() not null,
  source       text not null default 'webhook', -- webhook | poll
  user_gid     text,
  resource_gid text not null,
  resource_type text not null default '',      -- task | story | project …
  action       text not null,                  -- added|changed|removed|deleted|undeleted
  change_field text,                           -- e.g. completed, assignee, due_on
  project_gid  text,
  raw          jsonb not null
);
create index if not exists asana_events_user_time on asana_events (user_gid, created_at);
create index if not exists asana_events_project_time on asana_events (project_gid, created_at);
```

`team_users.asana_user_gid` already exists in the identity-layer plan and is
the join from events to people.

## 3. Code layout (follows repo conventions)

```
app/lib/asana-core.ts     pure: signature verify, event normalize, dedup-key,
                          rollup aggregation — no I/O, unit-tested (vitest)
app/lib/asana.ts          API client: PAT fetch wrapper, Retry-After handling,
                          register/list webhooks, poll events, hydrate tasks
app/api/asana/webhook/route.ts   handshake + verify + fast insert  (PUBLIC)
app/inngest/functions.ts  + asanaReconcile (15-min cron)
app/api/team/activity/route.ts   rollup query for the UI      (gated, admin/self)
app/dashboard/activity/page.tsx  the Rollup page
```

Authorization: rollup route is server-side gated — admins see everyone, a
member sees only their own row (BUILD_PLAN §3.3 non-negotiables: no invisible
collection, everyone can see their own data, transparency notice ships inside
phase 1).

## 4. Rollup page (phase-1 surface, BUILD_PLAN §3.2)

Filters: date range + person. Columns per person:
**completed** (count of `action=changed, change_field=completed` → hydrated
true), **assigned / in-progress**, **overdue** (due_on < today, not completed —
needs a daily hydration snapshot, not just events), **last activity**,
**event count**. Timezone-correct per viewer; employees vs contractors
distinguished (both from `team_users`).

## 5. Build order

| step | what | size |
|---|---|---|
| 1 | migration + `asana-core.ts` with tests (verify, normalize, dedup key) | ½ day |
| 2 | API client + webhook route (handshake, signature, insert) | ½–1 day |
| 3 | registration script + reconciliation cron (412 baseline, re-register) | 1 day |
| 4 | project→client mapping admin (small table editor in Settings) | ½ day |
| 5 | rollup query + Activity page + transparency notice | 1–1½ days |

Total ≈ 3–5 days, matching the BUILD_PLAN estimate. Depends on the identity
layer (`team_users`) existing — that's milestone 1 in §4 sequencing.

## 6. Acceptance

- Complete a task in Asana → row in `asana_events` within a minute, Rollup
  updates.
- Kill the webhook (delete in Asana) → reconciler detects within 15 min,
  re-registers, no events lost across the gap (webhook + poll overlap).
- Signature-invalid POST to the route → 401, nothing inserted.
- A non-admin team member sees only their own row.
- Transparency notice visible in-app before anyone else's data is.
