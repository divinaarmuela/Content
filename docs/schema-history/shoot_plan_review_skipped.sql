-- NO QUALITY CHECK NEEDED, SAID ON THE SHOOT (29 Oct 2026, Manal for StretchWorks: "I send to the client I don't send to
-- anyone else to approve"; the owner: "allow shoot briefs to skip quality check"). One switch on the shoot page, for an
-- account manager or a super admin: the plan's quality review gate (shoot-sop-core.planReviewRequired) does not apply,
-- the Quality review step leaves the strip, and the shoot moves on without it. Who switched it, and when, is kept.
alter table batches add column if not exists plan_review_skipped boolean;
alter table batches add column if not exists plan_review_skipped_by text;
alter table batches add column if not exists plan_review_skipped_at timestamptz;
