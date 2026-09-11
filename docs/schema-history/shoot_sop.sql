-- THE SHOOT BRIEF SOP (Team's Playbook, July 2026, §3) on the shoot itself.
--
-- The brief must be fully prepared and shared 7 days before the shoot ("no
-- brief, no shoot"); it is not complete until nine things are filled in;
-- every team member on it acknowledges it before work starts; the AM signs
-- it off as "go"; Ops sends the reminder the day before; after the shoot
-- the footage is handed over and the editor is confirmed on priorities and
-- deadline. Each of those is a stamp here, and the columns of the Shoot
-- brief boards page are DERIVED from the stamps and the calendar
-- (app/lib/shoot-sop-core.ts) — nothing is a second status field.

-- the nine required contents (the ones the brief did not already hold:
-- shoot_date, location, shot_list and planned_deliverables were there)
alter table batches add column if not exists objective text;
alter table batches add column if not exists script text;
alter table batches add column if not exists call_time text;
alter table batches add column if not exists talent text;
alter table batches add column if not exists props_wardrobe text;
alter table batches add column if not exists client_availability text;
alter table batches add column if not exists editor_priorities text;
alter table batches add column if not exists edit_deadline date;

-- who is on the shoot: the editor the footage is handed to, and the crew
-- (videographer, presenter, whoever the AM adds). Every one of them
-- acknowledges the brief; acknowledgements is [{user_id, at}].
alter table batches add column if not exists editor_id uuid references team_users(id) on delete set null;
alter table batches add column if not exists crew_ids jsonb not null default '[]'::jsonb;
alter table batches add column if not exists acknowledgements jsonb not null default '[]'::jsonb;

-- the timeline, as stamps
alter table batches add column if not exists brief_shared_at timestamptz;
alter table batches add column if not exists brief_shared_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists aligned_at timestamptz;
alter table batches add column if not exists client_confirmed_at timestamptz;
alter table batches add column if not exists go_at timestamptz;
alter table batches add column if not exists go_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists reminder_sent_at timestamptz;
alter table batches add column if not exists footage_handed_at timestamptz;
alter table batches add column if not exists footage_handed_by uuid references team_users(id) on delete set null;

-- the 7-day nudge went out (once per shoot, never twice)
alter table batches add column if not exists late_nudged_at timestamptz;

-- Ops (Abby) — copied on the 24-hour ladder and told when a brief is late.
-- playbook_roles.sql declares this in the same statement as
-- quality_reviewer, and the type generator reads only the first column of a
-- multi-column ALTER, so it is said again here on its own.
alter table team_users add column if not exists ops_contact boolean not null default false;
