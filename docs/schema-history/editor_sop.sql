-- The Video Editors SOP (Team's Playbook, July 2026), 11 Sep 2026.
-- §7 the 24-hour blocker rule: what is blocked, who was asked, when, and the
-- two escalation stamps. One column per ALTER — the type generator reads only
-- the first column of a multi-column ALTER.
alter table content_items add column if not exists blocked_need text;
alter table content_items add column if not exists blocked_from_id uuid;
alter table content_items add column if not exists blocked_note text;
alter table content_items add column if not exists blocked_at timestamptz;
alter table content_items add column if not exists blocked_nudged_12_at timestamptz;
alter table content_items add column if not exists blocked_nudged_24_at timestamptz;
-- §6 acknowledge the same day: the morning-after nudge, sent once
alter table content_items add column if not exists ack_nudged_at timestamptz;
-- §4 quality check before submitting: the version the ticks were made on
alter table content_items add column if not exists qc_done_version integer;
-- §5 handover ticks, the editor's own record
alter table content_items add column if not exists handover_drive_at timestamptz;
alter table content_items add column if not exists handover_source_at timestamptz;
-- "Martin heads the Video Editing team and is the first point of contact for
-- the editors" — a flag on a person, never a name in the code
alter table team_users add column if not exists editors_lead boolean not null default false;
