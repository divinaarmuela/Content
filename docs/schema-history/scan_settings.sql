-- ═══ Inbox scanner: settings, mailbox control, run history ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Three concerns, three tables:
--   scan_settings  — one row, the global knobs a super admin controls
--   scan_mailboxes — which addresses are eligible, one row per address
--   scan_runs      — per-mailbox health, so a mailbox that quietly stops
--                    working is visible instead of silently absent

create table if not exists scan_settings (
  id                    int         primary key default 1 check (id = 1),
  -- how far back and how wide each pass looks
  lookback_days         int         not null default 3  check (lookback_days between 1 and 30),
  max_messages          int         not null default 25 check (max_messages between 1 and 100),
  -- classification thresholds
  min_confidence        numeric(3,2) not null default 0.60 check (min_confidence >= 0 and min_confidence <= 1),
  duplicate_window_days int         not null default 30 check (duplicate_window_days between 0 and 365),
  -- when the model is unavailable, fall back to rules and flag for review
  -- rather than dropping enquiries on the floor
  rules_only            boolean     not null default false,
  schedule_enabled      boolean     not null default true,
  -- senders that never become leads regardless of what the model thinks
  blocked_domains       text[]      not null default '{}',
  blocked_senders       text[]      not null default '{}',
  updated_at            timestamptz not null default now(),
  updated_by            text
);

insert into scan_settings (id) values (1) on conflict (id) do nothing;

create table if not exists scan_mailboxes (
  email      text        primary key,
  enabled    boolean     not null default true,
  label      text,
  -- 'shared'   = configured in env (hello@ etc)
  -- 'connected'= a team member's Google account via Clerk
  source     text        not null default 'shared' check (source in ('shared','connected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists scan_runs (
  id            uuid        primary key default gen_random_uuid(),
  mailbox       text        not null,
  trigger       text        not null default 'manual' check (trigger in ('manual','scheduled','event')),
  status        text        not null default 'running' check (status in ('running','success','error')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  scanned       int         not null default 0,
  claimed       int         not null default 0,
  leads_created int         not null default 0,
  skipped       int         not null default 0,
  errors        int         not null default 0,
  error         text
);

create index if not exists scan_runs_mailbox_idx on scan_runs (mailbox, started_at desc);
create index if not exists scan_runs_started_idx on scan_runs (started_at desc);

-- 'needs_review' is what the rules-only fallback produces: survived the
-- prefilter, never seen by the model, waiting on a human.
alter table email_ingest_log drop constraint if exists email_ingest_log_status_check;
alter table email_ingest_log add constraint email_ingest_log_status_check
  check (status in ('pending','lead_created','not_a_lead','skipped','error','needs_review'));

alter table scan_settings  enable row level security;
alter table scan_mailboxes enable row level security;
alter table scan_runs      enable row level security;
