-- NO BRIEF, NO SHOOT — enforced (11 Sep 2026, after the live walk).
-- A plan shared fewer than 7 days before the shoot cannot be confirmed as
-- go by an account manager. A super admin may go ahead anyway, with a
-- reason, and Ops is told once. The reason stays on the shoot.
alter table batches add column if not exists go_override_reason text;
alter table batches add column if not exists go_override_by uuid references team_users(id) on delete set null;
-- the 7-day nudge also fires once for a plan that was SHARED late, not only
-- for one still being written
alter table batches add column if not exists late_share_nudged_at timestamptz;
