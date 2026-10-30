-- ═══ Mark a card done ═══
-- Idempotent.
--
-- The owner, 30 Oct 2026: "add a completed tab on each card it will then go to the last column in editor and
-- designer … after 1 and a half weeks they will disappear … mark done can be during any stage … any AM, editor or
-- super admin can do it". A stamp, not a status: the card's own stage, files and history are untouched; the Editor
-- and Designer pages put a stamped card in their last lane (Done) and drop it from the board a week and a half later.
alter table content_items add column if not exists done_at timestamptz;
alter table content_items add column if not exists done_by uuid;
