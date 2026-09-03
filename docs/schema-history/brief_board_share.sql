-- ═══ Board sharing is its own decision + boards get names ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Sharing a shoot brief (details, shot list, deliverables) and sharing the
-- planning BOARD are now two separate toggles: a messy working board should
-- not be forced onto the client just to show them the shoot date. Existing
-- shared shoots keep showing their board (backfilled from the old toggle).

alter table batches add column if not exists share_board boolean;
update batches set share_board = coalesce(shared_with_client, false) where share_board is null;
alter table batches alter column share_board set default false;

alter table batches add column if not exists board_name text;
