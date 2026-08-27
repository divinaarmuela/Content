-- ═══ Tagging on shoot comments ═══
-- "@Name" in a shoot's comment thread now assigns that comment to a team
-- member, exactly as item comments already do: they get the email, the
-- notification, the "Waiting on you" card, and a tick to mark it done.
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on portal_comments.sql (batch_comments) and identity.sql (team_users).

alter table batch_comments
  add column if not exists assigned_to uuid references team_users(id) on delete set null;

alter table batch_comments
  add column if not exists resolved boolean not null default false;

create index if not exists batch_comments_assigned_idx
  on batch_comments (assigned_to) where resolved = false;
