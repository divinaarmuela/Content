-- THE SHOOT PAGE REVAMP (13 Sep 2026): who did what, and the client's answer
-- on the shoot itself. The plan-document approval (a shoot_brief item riding
-- the content pipeline) is retired from the page; old rows stay in place.

-- who made the shoot (owner_id is the account manager on it, which may differ)
alter table batches add column if not exists created_by uuid references team_users(id) on delete set null;

-- the AM's two ticks carry a person now
alter table batches add column if not exists aligned_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists client_confirmed_by uuid references team_users(id) on delete set null;

-- Ops pressed Reminder sent
alter table batches add column if not exists reminder_sent_by uuid references team_users(id) on delete set null;

-- the plan went to the client, from the shoot page, and what they said back
alter table batches add column if not exists client_shared_at timestamptz;
alter table batches add column if not exists client_shared_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists client_decision text;
alter table batches add column if not exists client_decided_at timestamptz;
alter table batches add column if not exists client_decision_note text;
