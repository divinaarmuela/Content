-- ═══ Agreement start date ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- When the standing deal actually began. At-risk pacing measures from this
-- date: a client signed mid-month is expected to deliver against the days
-- the agreement was live — not look "behind" on day one — and a client whose
-- agreement starts next month owes nothing yet.

alter table client_agreements add column if not exists start_date date;
