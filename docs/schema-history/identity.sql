-- ═══ Milestone 1: identity layer ═══
-- team_users, client assignments (m2m), invites, notification outbox.
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on website_cms.sql (clients table).

-- ─── Team users ───
-- Mirrors Clerk identities and adds everything Clerk shouldn't hold.
-- One row per human. Shared-mailbox super admins get rows too, but the
-- audit caveat is documented in docs/BUILD_PLAN.md §1.3.
create table if not exists team_users (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  -- unique constraints double as race-condition guards: concurrent sign-in
  -- syncs can never create duplicate rows for one identity
  clerk_user_id   text        unique,
  email           text        not null unique,
  name            text        not null default '',
  role            text        not null default 'editor'
                  check (role in ('super_admin','account_manager','editor','scheduler','client')),
  employment_type text        not null default 'employee'
                  check (employment_type in ('employee','contractor')),
  timezone        text        not null default 'Australia/Melbourne',
  workday_start   time        not null default '09:00',
  workday_end     time        not null default '17:00',
  -- for client-role users: which client workspace they belong to
  client_id       uuid        references clients(id) on delete set null,
  -- for the activity dashboard later
  asana_user_gid  text,
  notification_prefs jsonb    not null default '{"email": true}'::jsonb,
  active_status   boolean     not null default true
);

create index if not exists team_users_role_idx on team_users (role) where active_status;

-- ─── Client assignments (many-to-many) ───
-- AMs and editors are assigned to specific clients. Composite PK prevents
-- duplicate assignments by construction.
create table if not exists team_user_clients (
  team_user_id uuid not null references team_users(id) on delete cascade,
  client_id    uuid not null references clients(id)    on delete cascade,
  assigned_at  timestamptz default now() not null,
  assigned_by  uuid references team_users(id) on delete set null,
  primary key (team_user_id, client_id)
);

create index if not exists team_user_clients_client_idx on team_user_clients (client_id);

-- ─── Invites ───
-- Tracks invitations sent through Clerk so role/assignments/metadata can be
-- stamped when the person first signs in. Partial unique index = one PENDING
-- invite per email ever (re-inviting revokes the old one first); accepted /
-- revoked invites stay as history.
create table if not exists team_invites (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now() not null,
  email           text        not null,
  role            text        not null
                  check (role in ('super_admin','account_manager','editor','scheduler','client')),
  employment_type text        not null default 'employee'
                  check (employment_type in ('employee','contractor')),
  timezone        text        not null default 'Australia/Melbourne',
  client_id       uuid        references clients(id) on delete set null,
  assigned_client_ids uuid[]  not null default '{}',
  invited_by      uuid        references team_users(id) on delete set null,
  clerk_invitation_id text,
  status          text        not null default 'pending'
                  check (status in ('pending','accepted','revoked'))
);

create unique index if not exists team_invites_pending_email_uidx
  on team_invites (lower(email)) where status = 'pending';

-- ─── Notification outbox ───
-- Exactly-once sending: every notification is INSERTed with a dedupe_key
-- first; the unique constraint makes concurrent producers collide, and only
-- the row that won the insert gets sent. Channels beyond email slot in later
-- (desktop push) without schema change.
create table if not exists notification_log (
  id           uuid        default gen_random_uuid() primary key,
  created_at   timestamptz default now() not null,
  dedupe_key   text        not null unique,
  event_type   text        not null,
  recipient_id uuid        references team_users(id) on delete cascade,
  recipient_email text     not null,
  subject      text        not null,
  body_html    text        not null,
  entity_type  text,
  entity_id    text,
  channel      text        not null default 'email',
  status       text        not null default 'pending'
               check (status in ('pending','sent','failed','skipped')),
  sent_at      timestamptz,
  error        text,
  retry_count  int         not null default 0
);

create index if not exists notification_log_pending_idx
  on notification_log (created_at) where status = 'pending';

-- ─── updated_at maintenance ───
drop trigger if exists team_users_updated_at on team_users;
create trigger team_users_updated_at
  before update on team_users
  for each row execute function set_updated_at();

-- ─── Row level security ───
-- All access flows through the Next.js server (service role). Nothing for anon.
alter table team_users        enable row level security;
alter table team_user_clients enable row level security;
alter table team_invites      enable row level security;
alter table notification_log  enable row level security;
