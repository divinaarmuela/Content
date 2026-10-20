-- ═══ Archive: shoots, work cards and boards put away (the owner, 20 Oct 2026) ═══
-- "for every shoots editor design boards. add an archive feature please which also removes it from the portal …
-- so we dont have to see it in the page and its clean". Read by scripts/gen-db-types.mjs; RTDB, nothing to run.
--
-- archived_at set = put away: off the team's lists (behind "Archived"), off the client's portal. Cleared = back.
-- Nothing is deleted; the row, its files and its history stay exactly as they were.

alter table batches add column if not exists archived_at timestamptz;
alter table batches add column if not exists archived_by uuid;
alter table content_items add column if not exists archived_at timestamptz;
alter table content_items add column if not exists archived_by uuid;
