-- ═══ Page access ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- A super admin can open a dashboard page to roles that would not normally
-- see it. The role ladder stays the default; this table only ever GRANTS,
-- never revokes, so a misconfiguration cannot lock the team out of work they
-- are supposed to reach.

create table if not exists page_access (
  href       text primary key,          -- '/dashboard/leads'
  roles      text[] not null default '{}',  -- extra roles allowed to see it
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table page_access enable row level security;
