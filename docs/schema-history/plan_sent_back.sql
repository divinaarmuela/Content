-- SENT BACK (13 Sep 2026): the quality checker's note when a plan is sent
-- back lives on the shoot, so the Where panel can say "Sent back by Joy: …"
-- above the one button. Cleared by the next ask. One column per ALTER.
alter table batches add column if not exists plan_sent_back_at timestamptz;
alter table batches add column if not exists plan_sent_back_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists plan_sent_back_note text;
