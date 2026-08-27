-- ═══ Getting started panel, per page ═══
-- The panel now appears on Editor, Scheduler, Production and the item page as
-- well as the Overview, each with its own three steps. One person dismisses
-- each one separately, so the dismissals are a list of "role:page" keys.
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on getting_started.sql.

alter table team_users
  add column if not exists getting_started_dismissed_pages jsonb not null default '[]'::jsonb;
