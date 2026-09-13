-- THE PLAN GOES THROUGH THE QUALITY CHECK TOO (13 Sep 2026, the owner: "for
-- shoot briefs that has been created and assigned to AM or AM that created
-- it, must go through quality review too … not for super admins"). A plan
-- written or held by an account manager or a general user is passed by a
-- quality checker before Go; a super admin's plan is exempt, and a super
-- admin may pass one in the reviewer's place. One column per ALTER.
alter table batches add column if not exists plan_reviewed_at timestamptz;
alter table batches add column if not exists plan_reviewed_by uuid references team_users(id) on delete set null;
