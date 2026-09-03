-- ═══ Client agreements + shoot briefs (pre-production) ═══
-- Idempotent. Run in the Supabase SQL editor BEFORE deploying the build.
--
-- A) client_agreements: the standing deal — monthly deliverable quantities
--    and retained services — recorded once per client and read everywhere.
-- B) batches grow into shoot briefs: concept, references, shot list, planned
--    deliverables, and a lifecycle (brief → locked → shot → wrapped) where
--    locking the shoot date is the explicit commitment that opens production.

-- A) the standing deal (one row per client)
create table if not exists client_agreements (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  client_id uuid not null references clients(id) on delete cascade unique,
  -- [{ "type":"static", "label":"Graphics", "monthly_qty":20 }]
  deliverable_lines jsonb not null default '[]'::jsonb,
  -- [{ "key":"manychat", "label":"ManyChat automation", "note":"", "active":true }]
  services jsonb not null default '[]'::jsonb,
  notes text,
  updated_by uuid references team_users(id) on delete set null
);
alter table client_agreements enable row level security;
drop trigger if exists client_agreements_updated_at on client_agreements;
create trigger client_agreements_updated_at before update on client_agreements
  for each row execute function set_updated_at();

-- B) batches → shoot briefs. ORDER MATTERS: add column, backfill, THEN default+not null.
alter table batches add column if not exists status text;
update batches set status = 'shot' where status is null;   -- legacy shoots: item-attachable, out of planning
alter table batches alter column status set default 'brief';
alter table batches alter column status set not null;
do $$ begin
  alter table batches add constraint batches_status_check
    check (status in ('brief','locked','shot','wrapped'));
exception when duplicate_object then null; end $$;
alter table batches add column if not exists concept text;
alter table batches add column if not exists location text;
alter table batches add column if not exists shot_list jsonb not null default '[]'::jsonb;            -- [{id,text,type?,qty?,done}]
alter table batches add column if not exists planned_deliverables jsonb not null default '[]'::jsonb; -- [{type,qty}]
alter table batches add column if not exists reference_media jsonb not null default '[]'::jsonb;      -- [{kind:'image'|'link',url,name?,note?}]
alter table batches add column if not exists locked_at timestamptz;
alter table batches add column if not exists locked_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists shot_at timestamptz;
alter table batches add column if not exists proposal_id uuid references shoot_proposals(id) on delete set null;
create index if not exists batches_status_idx on batches (status);

-- C) proposal back-link (informational confirmation only — never auto-locks)
alter table shoot_proposals add column if not exists batch_id uuid references batches(id) on delete set null;

-- D) monthly_commitments: video was missing an override column
alter table monthly_commitments add column if not exists video_quota int not null default 0;
