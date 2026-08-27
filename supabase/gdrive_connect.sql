-- ═══ Connect Google Drive ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One Drive account for the whole agency, not one per person: the folder tree
-- IS the shared filing cabinet, so a second connection would only fork it.
-- Hence a single row keyed 'team' — the primary key makes "there is exactly
-- one" a database fact rather than a convention someone has to keep.
--
-- Same encryption envelope as the calendar/inbox connections: the refresh
-- token is AES-256-GCM ciphertext (app/lib/secret-box.ts) and is never
-- returned by any read endpoint.
--
-- Why root_folder_id and not a path: Drive has no paths. A folder is an id,
-- and two folders may share a name in the same parent without complaint. The
-- app works under a root folder it CREATED itself — which is the only kind of
-- folder the drive.file scope can still see afterwards — so the id of that
-- root is the anchor everything else hangs from, and root_name is only what
-- it was called when we made it.

create table if not exists drive_connection (
  id                      text primary key default 'team',
  account_email           text,
  account_name            text,
  refresh_token_encrypted text,            -- AES-256-GCM; never leaves the server
  root_name               text not null default 'Clients',
  root_folder_id          text,            -- the folder WE created; drive.file sees it forever
  connected_by            text,
  connected_at            timestamptz,
  created_at              timestamptz not null default now()
);

alter table drive_connection enable row level security;

-- Where a shoot's folder and an item's folder live. Stored rather than
-- recomputed: a folder that was renamed in Drive keeps working from the id we
-- recorded, and the id is the audit trail for what we created.
alter table batches       add column if not exists drive_folder_id text;
alter table batches       add column if not exists drive_url       text;
alter table content_items add column if not exists drive_folder_id text;
alter table content_items add column if not exists drive_url       text;

-- ── the Dropbox integration this replaces ────────────────────────────────
-- The agency chose Google Drive instead. The Dropbox migration was run on the
-- live database, so its table and columns really are there and really do have
-- to go — leaving them would leave a second, silently stale set of folder
-- links on every shoot and item.
--
-- NOT touched: content_versions.dropbox_url, which predates the integration
-- and is the editor's "master file link" field (it has always accepted a Drive
-- URL too). Renaming that is a product change, not a cleanup.

drop table if exists dropbox_connection;

alter table batches       drop column if exists dropbox_path;
alter table batches       drop column if exists dropbox_url;
alter table content_items drop column if exists dropbox_path;
alter table content_items drop column if exists dropbox_url;
