-- ═══ Raw footage gets its own mirror target ═══
-- Idempotent. Run in the Supabase SQL editor. Requires gdrive_mirror.sql.
--
-- Job-pack assets — the footage handed to an editor — used to be mirrored to
-- `target: 'item'`, which is the item's own `02 Edits/{Item}` folder. That is
-- the editing bench: it holds the cuts the editor MADE. Dropping the source
-- material in beside them is the complaint that started this — "you added to
-- the wrong files, that's not the edited one" — and it also hides the day's
-- footage from every other item cut from the same shoot.
--
-- So raw material becomes a target of its own:
--
--   raw   → {Client}/{Shoot}/01 Raw            (a shoot's footage, once)
--         → {Client}/_No shoot/{Item}/Raw      (a deliverable with no shoot)
--   item  → {Client}/{Shoot}/02 Edits/{Item}   (versions and slides — unchanged)
--
-- The check constraint is NAMED in gdrive_mirror.sql precisely so it can grow
-- without a migration nobody dares run: drop it by that name, add it back
-- wider. Two statements, and re-running them changes nothing.

alter table drive_files drop constraint if exists drive_files_target_check;
alter table drive_files add  constraint drive_files_target_check
  check (target in ('raw','item','final','scheduled','from_client','brand'));

-- Nothing is back-filled here on purpose. The rows already misfiled point at
-- REAL Drive files sitting in `02 Edits`, and rewriting `target` in SQL would
-- only make the database describe them wrongly in a new way. The file has to
-- move first — so the correction lives in the half-hourly mirror sweep
-- (`migrateMisfiledRaw` in app/lib/gdrive-mirror.ts), which re-parents the
-- Drive file into `01 Raw` and rewrites the row only once Drive has agreed.
-- Capped at 50 a run, idempotent, and finished as soon as there is nothing
-- left to move.
--
-- To watch it drain:
--   select target, count(*) from drive_files group by target order by target;
