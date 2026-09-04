-- ═══ Files page: a copy somebody filed by hand ═══
-- Idempotent. Requires gdrive_mirror.sql.
--
-- The Files page (/dashboard/files) lets a person drop a file onto a folder in
-- the owner's Drive. That copy is not a mirror of anything: there is no source
-- URL behind it, no item it belongs to, and no rule saying where it should
-- live — somebody simply put it there. It still has to be recorded, or the
-- page and the mirror would disagree about what is in a folder the moment
-- anybody used it.
--
-- Hence a sixth target. The check constraint is NAMED in gdrive_mirror.sql
-- precisely so it can grow without a migration nobody dares run: drop it by
-- that name, add it back wider. Two statements, and re-running them changes
-- nothing.

alter table drive_files drop constraint if exists drive_files_target_check;
alter table drive_files add  constraint drive_files_target_check
  check (target in ('raw','item','final','scheduled','from_client','brand','files'));

-- Where the file is NOW, rather than which copy it is.
--
-- The table was written for "this source URL has been copied to this target",
-- which never had to know where in Drive the copy ended up: the target implied
-- the folder. The Files page can move a file into any folder a person chooses,
-- so the folder became a fact of its own. Without it, the page and the mirror
-- start disagreeing the moment somebody drags something.
--
-- `moved_at` is only ever written after a PERSON confirmed a move and Google
-- agreed to it. Nothing in this app moves a file on its own — that is the
-- owner's standing instruction, and these columns record their decisions
-- rather than making any.
alter table drive_files add column if not exists parent_id   text;
alter table drive_files add column if not exists name        text;
alter table drive_files add column if not exists uploaded_by text;
alter table drive_files add column if not exists moved_at    timestamptz;

-- "what is in this folder, according to us" — the join the info panel and the
-- Client filter both read
create index if not exists drive_files_parent_idx on drive_files (parent_id);

-- Nothing is back-filled. Every existing row points at a real Drive file whose
-- folder we could only guess at from its target, and a guess written into the
-- database is worse than a blank: the page shows what Drive says, and the
-- column fills itself in as files are actually moved.
