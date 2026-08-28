-- ═══ Monthly update — "Content Itinerary" ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- The twin of intake_forms, but RECURRING: one planning form per client-month.
-- Staff generate it each month, the client fills it in via a token link (no
-- login), and it lands as a read-only answers page in the dashboard. Unlike the
-- intake form it is INTERNAL — the client is never emailed a copy; the chosen
-- team members are, on submission.
--
-- `definition` is a FROZEN copy of the monthly template taken at creation, so
-- editing the code template later never rewrites a form a client is halfway
-- through. A super admin may still edit one form's own questions, but only
-- before the client has started — see updateMonthlyDefinition.

create table if not exists monthly_updates (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  client_id       uuid        not null references clients(id) on delete cascade,
  -- the (client, month, year) this planning form is FOR
  month           int         not null check (month between 1 and 12),
  year            int         not null check (year between 2000 and 2100),
  -- frozen at creation; never rewritten from the template source
  definition      jsonb       not null,
  token           uuid        not null default gen_random_uuid(),
  status          text        not null default 'draft'
                              check (status in ('draft','sent','in_progress','submitted')),
  -- keyed by block id; a partial autosave merges rather than replaces
  answers         jsonb       not null default '{}'::jsonb,
  -- who is emailed the answers + PDF on submission. NULL = fall back to the
  -- sending mailbox; [] = notify nobody. Chosen from the team at creation,
  -- editable afterwards. There is deliberately NO send-copy-to-client column:
  -- this form is internal, and the client is never emailed their submission.
  notify_emails   text[],
  sent_at         timestamptz,
  -- recorded on first open, but does NOT advance status — "started" means typed
  first_opened_at timestamptz,
  submitted_at    timestamptz,
  reopened_at     timestamptz,
  title           text        not null default '',
  created_by      uuid        references team_users(id) on delete set null
);

-- ONE planning form per client-month. "Create" for a month that already has a
-- form OPENS that form rather than making a duplicate — the app resolves the
-- conflict through this constraint (see createMonthlyForm).
create unique index if not exists monthly_updates_client_month_uidx
  on monthly_updates (client_id, year, month);

-- the token is the credential, so it must be unguessable AND unique
create unique index if not exists monthly_updates_token_uidx on monthly_updates (token);

-- newest first, for the client's list of past months
create index if not exists monthly_updates_client_idx
  on monthly_updates (client_id, year desc, month desc);

-- deny-by-default, like every other table; the service role bypasses RLS and
-- browser code never touches this directly
alter table monthly_updates enable row level security;
