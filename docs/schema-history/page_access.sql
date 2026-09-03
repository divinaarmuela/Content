-- ═══ Page access ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- A super admin can open a dashboard page to an individual person. Their role
-- still decides what they see by default; a grant only ever ADDS, so a
-- misconfiguration cannot lock someone out of the work they were hired to do.
--
-- Per PERSON rather than per role: "let Manal see Leads" is the actual
-- request, and granting it to every account manager to reach one of them is
-- how permissions quietly sprawl.

-- the earlier role-based shape, replaced
drop table if exists page_access;

create table if not exists user_page_access (
  team_user_id uuid not null references team_users(id) on delete cascade,
  href         text not null,                 -- '/dashboard/leads'
  granted_at   timestamptz not null default now(),
  granted_by   text,
  primary key (team_user_id, href)
);

create index if not exists user_page_access_user_idx on user_page_access (team_user_id);

alter table user_page_access enable row level security;
