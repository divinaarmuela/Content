-- The Team's Playbook (July 2026) and Abby's rule of 11 Sep 2026: every
-- graphic, story, reel and caption passes a QUALITY REVIEWER (Joy) before it
-- reaches a scheduler, and the 24-hour blocker ladder copies OPS (Abby).
-- Both are flags on a person, not roles: Joy keeps her role and a super
-- admin can always stand in.
alter table team_users
  add column if not exists quality_reviewer boolean not null default false,
  add column if not exists ops_contact boolean not null default false;

-- Who schedules for this client by default (Cath, Raven): a card that passes
-- quality check is handed to them without anyone picking names.
alter table clients
  add column if not exists default_scheduler_ids jsonb not null default '[]'::jsonb;

-- The playbook counts PRODUCED, DELIVERED, PUBLISHED. Delivered is the
-- moment the final was sent to the client — date stamped, "the log".
alter table content_items
  add column if not exists delivered_at timestamptz;
