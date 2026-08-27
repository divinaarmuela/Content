-- ═══ Getting started panel ═══
-- One column: when this person pressed "Got it" on the three-step panel, and
-- which role they were in at the time. Storing the role (not just a boolean)
-- means an editor promoted to account manager sees the new role's three steps
-- once, instead of never seeing onboarding again.
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Depends on identity.sql (team_users).

alter table team_users
  add column if not exists getting_started_dismissed_at timestamptz;

alter table team_users
  add column if not exists getting_started_dismissed_role text;
