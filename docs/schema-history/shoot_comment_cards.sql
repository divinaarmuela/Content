-- ═══ Comments pinned to ONE card of the shoot's planning board ═══
-- A client (or a team member) picks any card on the shoot board — a note,
-- an image, a link, a post mock-up, a board tile — and leaves a comment on
-- it. The comment is a normal shoot comment (same table, same thread, same
-- notifications) that also remembers WHICH card it is about. Null = the
-- shoot's general thread, exactly as every row written before this column.
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on portal_comments.sql (batch_comments).

alter table batch_comments
  add column if not exists card_id text;
