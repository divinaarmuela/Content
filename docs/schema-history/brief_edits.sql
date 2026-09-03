-- ═══ Who last touched a shoot brief ═══
-- Idempotent. Run in the Supabase SQL editor. The brief page shows
-- "Last edited by <name> · <time>"; it degrades to nothing until this runs.

alter table batches add column if not exists last_edited_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists last_edited_at timestamptz;
