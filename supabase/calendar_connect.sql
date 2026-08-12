-- ═══ Connect a Google Calendar ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- For shoot planning: a team member connects a calendar (hello@, contact@, or
-- their own) once, and the dashboard Availability view reads busy times from
-- all enabled calendars. Same consent flow and encryption envelope as
-- "Connect my inbox" — the Internal Google app, so only @mdmmarketing.com.au
-- accounts can consent, enforced by Google.

create table if not exists calendar_accounts (
  email                   text primary key,
  refresh_token_encrypted text,           -- AES-256-GCM (app/lib/secret-box.ts); never returned by any read endpoint
  enabled                 boolean not null default true,  -- toggled in the Availability view
  connected_at            timestamptz,
  connected_by            text,
  created_at              timestamptz not null default now()
);

alter table calendar_accounts enable row level security;
