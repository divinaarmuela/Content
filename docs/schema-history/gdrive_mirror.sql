-- ═══ Mirror every file into Google Drive ═══
-- Idempotent. Run in the Supabase SQL editor. Requires gdrive_connect.sql.
--
-- The folder tree told people WHERE work lives. This makes it true: a file
-- uploaded to the dashboard is copied into the item's Drive folder, the
-- approved cut is copied into the shoot's `03 Final`, and a scheduled piece is
-- copied into `_Scheduled/{YYYY-MM}` under the month it first goes out. Drive
-- stops being an index of the work and becomes a copy of it, which is what
-- "every file uploaded will go there" actually asks for.
--
-- ── Why a table at all ──
--
-- Because the upload runs in Inngest, and Inngest retries. A step that failed
-- after Drive had already taken the bytes would, on retry, upload the same
-- 2 GB master a second time — Drive has no unique-name constraint and would
-- keep both, so the folder would fill with duplicates nobody could tell apart.
-- `unique (source_url, target)` makes "this file is already there" a database
-- fact: the insert is the claim, and a retry that loses the claim knows it has
-- nothing left to do. Same pattern as email_ingest_log.gmail_message_id.
--
-- The key is (source_url, target) rather than (item_id, source_url): the SAME
-- file legitimately exists in three places at once — the item's folder, the
-- shoot's finals, and the scheduled month — and each copy is a separate row
-- with its own drive_file_id. Nothing here ever "moves"; the one exception is
-- a scheduled month that changes, which re-parents the existing file and keeps
-- the row (see app/lib/gdrive-mirror.ts).

create table if not exists drive_files (
  id            uuid primary key default gen_random_uuid(),
  -- null for a file that belongs to the CLIENT rather than to a piece of work:
  -- an intake delivery, a brand logo. client_id carries those.
  item_id       uuid references content_items(id) on delete cascade,
  client_id     uuid references clients(id) on delete cascade,
  source_url    text not null,           -- where we read the bytes from
  target        text not null,           -- which copy this row is
  drive_file_id text,                    -- the file Drive made; null while in flight
  drive_url     text,
  bytes         bigint,
  created_at    timestamptz not null default now(),
  unique (source_url, target)
);

-- added separately, and tolerantly, so re-running this file over an earlier
-- version of the table widens it instead of failing
alter table drive_files add column if not exists client_id uuid references clients(id) on delete cascade;

-- the target vocabulary, as a constraint that can GROW. A `check` written
-- inline could never be widened without dropping it by a name Postgres
-- invented; naming it means the next target is two statements, not a migration
-- nobody dares run.
alter table drive_files drop constraint if exists drive_files_target_check;
alter table drive_files add  constraint drive_files_target_check
  check (target in ('item','final','scheduled','from_client','brand'));

-- "how many files of this item are mirrored" is the item page's one line, and
-- it is asked on every item detail load
create index if not exists drive_files_item_idx on drive_files (item_id, target);
create index if not exists drive_files_client_idx on drive_files (client_id, target);

-- deny-by-default, like every other table here: only the service role reads
-- it, and the browser never touches Supabase directly
alter table drive_files enable row level security;
