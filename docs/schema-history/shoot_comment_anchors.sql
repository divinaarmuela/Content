-- ═══ Comments on the plan's own words (29 Oct 2026) ═══
-- The owner, with a video of Google Docs: select some words of the shoot plan and comment on exactly those. A comment
-- remembers which part of the plan (anchor_part: objective, a deliverable, a shot, a script…) and the words
-- (anchor_quote); a reply points at its first comment (parent_id). Null on every row written before this.
-- Depends on portal_comments.sql (batch_comments).
alter table batch_comments add column if not exists anchor_part text;
alter table batch_comments add column if not exists anchor_quote text;
alter table batch_comments add column if not exists parent_id uuid references batch_comments(id) on delete cascade;
