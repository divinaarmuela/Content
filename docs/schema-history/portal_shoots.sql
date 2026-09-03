-- ═══ Shoot plans on the client portal ═══
-- Idempotent. Run in the Supabase SQL editor; the code degrades gracefully
-- until it has run (no shoots section shows, nothing errors).
--
-- An account manager flips "Show on client portal" on a shoot brief and the
-- client's portal gains a SHOOT PLANS section: title, date, status,
-- deliverables, shot list, and a read-only view of the planning board.

alter table batches add column if not exists shared_with_client boolean not null default false;
