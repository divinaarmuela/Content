-- ASK FOR A REVIEW (13 Sep 2026, the owner: "general user sometimes needs to
-- create it, how are they going to send the brief for a review"). Whoever
-- writes the plan asks the account managers (or anyone they pick) to review
-- it; the reviewers are emailed the plan, and their "Aligned with the
-- strategist" tick is the sign-off. One column per ALTER (the generator).
alter table batches add column if not exists review_asked_at timestamptz;
alter table batches add column if not exists review_asked_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists review_asked_to jsonb;
