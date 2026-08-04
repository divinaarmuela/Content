-- ═══ Client records: contacts, notes, credentials ═══
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on website_cms.sql (clients) and identity.sql (team_users).

-- ─── Contacts ───
-- Replaces the single contact_name/email/phone on clients. A client is an
-- organisation; organisations have an owner, a marketing lead, a bookkeeper.
-- The old columns stay for now so nothing breaks mid-migration.
create table if not exists client_contacts (
  id         uuid        default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  client_id  uuid        not null references clients(id) on delete cascade,
  name       text        not null,
  role       text        not null default '',
  email      text        not null default '',
  phone      text        not null default '',
  -- who to contact first; a partial unique index means at most one per client
  is_primary boolean     not null default false,
  notes      text        not null default ''
);

create index if not exists client_contacts_client_idx on client_contacts (client_id);
create unique index if not exists client_contacts_one_primary
  on client_contacts (client_id) where is_primary;

-- ─── Notes ───
-- Append-only in spirit: every note records who wrote it and when, which is
-- the whole point of moving off the single free-text field on clients — that
-- field could be overwritten by anyone with no trace of who changed what.
create table if not exists client_notes (
  id         uuid        default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  client_id  uuid        not null references clients(id) on delete cascade,
  body       text        not null,
  -- set null rather than cascade: deleting a person must not delete the
  -- history of what they wrote
  author_id  uuid        references team_users(id) on delete set null,
  -- denormalised so an archived or deleted author still shows a name
  author_name text       not null default ''
);

create index if not exists client_notes_client_idx on client_notes (client_id, created_at desc);

-- ─── Credentials ───
-- Client logins for the platforms we manage on their behalf.
--
-- SECRETS ARE STORED ENCRYPTED, never as plaintext. The ciphertext is written
-- by the application (AES-256-GCM, key in CREDENTIALS_KEY) so a database dump,
-- a leaked backup, or read access to this table yields nothing usable. The
-- column is named for what it holds so nobody mistakes it for a password.
--
-- Everything else here is deliberately NOT secret — the platform, the
-- username, the URL — so the list can be shown without decrypting anything.
create table if not exists client_credentials (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null,
  client_id      uuid        not null references clients(id) on delete cascade,
  platform       text        not null,               -- Instagram, Meta Ads, Shopify…
  label          text        not null default '',    -- which account, when there are several
  username       text        not null default '',
  secret_cipher  text,                               -- AES-256-GCM, base64. NEVER plaintext.
  url            text        not null default '',
  notes          text        not null default '',
  -- an audit trail on who last touched a credential is the minimum for
  -- something this sensitive
  updated_by     uuid        references team_users(id) on delete set null,
  updated_by_name text       not null default ''
);

create index if not exists client_credentials_client_idx on client_credentials (client_id);

-- ─── updated_at maintenance ───
drop trigger if exists client_contacts_updated_at on client_contacts;
create trigger client_contacts_updated_at
  before update on client_contacts
  for each row execute function set_updated_at();

drop trigger if exists client_notes_updated_at on client_notes;
create trigger client_notes_updated_at
  before update on client_notes
  for each row execute function set_updated_at();

drop trigger if exists client_credentials_updated_at on client_credentials;
create trigger client_credentials_updated_at
  before update on client_credentials
  for each row execute function set_updated_at();

-- ─── Row level security ───
-- All access flows through the Next.js server (service role). Nothing for anon.
alter table client_contacts    enable row level security;
alter table client_notes       enable row level security;
alter table client_credentials enable row level security;

-- ─── MD Media's own credentials ───
-- Same shape as client_credentials, without a client. The agency has logins of
-- its own (its Meta Business, its Google Workspace, its Canva) and hanging
-- them off a fake client row would put them in that client's panel.
create table if not exists agency_credentials (
  id              uuid        default gen_random_uuid() primary key,
  created_at      timestamptz default now() not null,
  updated_at      timestamptz default now() not null,
  platform        text        not null,
  label           text        not null default '',
  username        text        not null default '',
  secret_cipher   text,                              -- AES-256-GCM, base64. NEVER plaintext.
  url             text        not null default '',
  notes           text        not null default '',
  updated_by      uuid        references team_users(id) on delete set null,
  updated_by_name text        not null default ''
);

drop trigger if exists agency_credentials_updated_at on agency_credentials;
create trigger agency_credentials_updated_at
  before update on agency_credentials
  for each row execute function set_updated_at();

alter table agency_credentials enable row level security;

-- ─── Note visibility ───
-- Not every note belongs in front of every team member: commercial terms, a
-- difficult conversation, a rate change. 'team' is the default because the
-- point of these notes is that the next person can pick the client up;
-- 'admins' is for commercially sensitive notes, and 'private' is visible only
-- to its author. All three are filtered server-side rather than hidden in the UI.
alter table client_notes
  add column if not exists visibility text not null default 'team';

do $$ begin
  alter table client_notes
    add constraint client_notes_visibility_check check (visibility in ('team','admins','private'));
exception when duplicate_object then null;
end $$;
