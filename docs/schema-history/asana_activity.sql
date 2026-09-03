-- ═══ Team Activity Dashboard — Asana ingestion (BUILD_PLAN §3) ═══
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on identity.sql (team_users) and website_cms.sql (clients).

-- ─── Webhook registrations ───
-- One per tracked project, owned by the service-account PAT. `hook_secret`
-- arrives in the X-Hook-Secret handshake and verifies every later delivery.
-- `sync_token` is the reconciliation baseline for the /events poll.
create table if not exists asana_webhooks (
  id                uuid        default gen_random_uuid() primary key,
  created_at        timestamptz default now() not null,
  project_gid       text        not null unique,
  webhook_gid       text,
  hook_secret       text,
  sync_token        text,
  last_heartbeat_at timestamptz,
  last_event_at     timestamptz,
  last_error        text
);

-- ─── Asana project → our client registry ───
-- The "client cut": lets activity be grouped by the client it was for.
create table if not exists asana_project_map (
  project_gid  text primary key,
  project_name text        not null default '',
  client_id    uuid        references clients(id) on delete set null,
  tracked      boolean     not null default true,
  created_at   timestamptz default now() not null
);

-- ─── Event store ───
-- Our own retention: Asana's /events history is only 24 hours.
-- Asana events carry no id, so `dedup_key` is a hash of the identifying
-- fields. The UNIQUE constraint is what makes the webhook path and the
-- reconciliation poll safe to overlap — same pattern as
-- email_ingest_log.gmail_message_id. Never check-then-write.
create table if not exists asana_events (
  id            uuid        default gen_random_uuid() primary key,
  dedup_key     text        not null unique,
  created_at    timestamptz not null,
  ingested_at   timestamptz default now() not null,
  source        text        not null default 'webhook'
                check (source in ('webhook','poll')),
  user_gid      text,
  resource_gid  text        not null,
  resource_type text        not null default '',
  action        text        not null,
  change_field  text,
  project_gid   text,
  raw           jsonb       not null
);

create index if not exists asana_events_user_time    on asana_events (user_gid, created_at desc);
create index if not exists asana_events_project_time on asana_events (project_gid, created_at desc);

-- ─── Task mirror ───
-- Events say a field *changed*, never what it changed to, and "open" and
-- "overdue" are statements about current state. Both need resolved truth, so
-- the reconciler mirrors the tasks it sees referenced.
create table if not exists asana_tasks (
  gid          text        primary key,
  name         text        not null default '',
  assignee_gid text,
  project_gid  text,
  completed    boolean     not null default false,
  completed_at timestamptz,
  due_on       date,
  modified_at  timestamptz,
  synced_at    timestamptz default now() not null,
  permalink_url text
);

create index if not exists asana_tasks_assignee on asana_tasks (assignee_gid) where not completed;
create index if not exists asana_tasks_completed_at on asana_tasks (completed_at desc);

-- ─── Row level security ───
-- All access flows through the Next.js server (service role). Nothing for anon.
alter table asana_webhooks    enable row level security;
alter table asana_project_map enable row level security;
alter table asana_events      enable row level security;
alter table asana_tasks       enable row level security;
