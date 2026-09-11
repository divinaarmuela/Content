-- THE HANDOVER NEEDS NO PRESS (11 Sep 2026, the owner: "from a shoot… it
-- doesn't auto update?"). Go makes the editor's cards; the morning after the
-- shoot the footage is handed over by itself and the editor is told once.
-- The stamp is claimed before the mail goes, so a press on "Footage is in"
-- and the nightly sweep can never tell the editor twice.
alter table batches add column if not exists footage_due_nudged_at timestamptz;
