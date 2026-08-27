-- ═══ Connect Dropbox ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One Dropbox account for the whole agency, not one per person: the folder
-- tree IS the shared filing cabinet, so a second connection would only fork
-- it. Hence a single row keyed 'team' — the primary key makes "there is
-- exactly one" a database fact rather than a convention someone has to keep.
--
-- Same encryption envelope as the calendar/inbox connections: the refresh
-- token is AES-256-GCM ciphertext (app/lib/secret-box.ts) and is never
-- returned by any read endpoint.

create table if not exists dropbox_connection (
  id                      text primary key default 'team',
  account_email           text,
  account_name            text,
  refresh_token_encrypted text,            -- AES-256-GCM; never leaves the server
  root_path               text not null default '/Clients',
  connected_by            text,
  connected_at            timestamptz,
  created_at              timestamptz not null default now()
);

alter table dropbox_connection enable row level security;

-- Where a shoot's folder and an item's folder live. Stored rather than
-- recomputed: a folder that was renamed in Dropbox keeps working from the
-- link we minted, and the path is the audit trail for what we created.
alter table batches       add column if not exists dropbox_path text;
alter table batches       add column if not exists dropbox_url  text;
alter table content_items add column if not exists dropbox_path text;
alter table content_items add column if not exists dropbox_url  text;
