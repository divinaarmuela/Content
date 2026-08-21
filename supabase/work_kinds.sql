-- ═══ Work kinds: the craft of an item (edit, graphics, copy…) ═══
-- Idempotent. Run in the Supabase SQL editor BEFORE deploying the build.
--
-- Orthogonal to content_type, which is the deliverable FORMAT and stays
-- wired to agreements/quotas/publishing untouched. Kinds are managed by the
-- team (archived, never deleted) and drive the item dialog, board display,
-- and suggested assignees.

create table if not exists work_kinds (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  slug          text not null unique,
  name          text not null,
  default_roles text[] not null default '{editor}',  -- suggested-assignee roles
  uses_media    boolean not null default true,       -- show raw-assets fields in forms
  color         text not null default 'zinc',        -- pick-list slug, validated in core
  active        boolean not null default true,
  sort_order    int not null default 0
);

insert into work_kinds (slug, name, default_roles, uses_media, color, sort_order) values
  ('edit',     'Video edit',  '{editor}',                      true,  'zinc',   0),
  ('graphics', 'Graphics',    '{editor}',                      true,  'pink',   1),
  ('copy',     'Copywriting', '{account_manager}',             false, 'sky',    2),
  ('strategy', 'Strategy',    '{account_manager,super_admin}', false, 'indigo', 3),
  ('other',    'Other',       '{editor}',                      true,  'zinc',   4)
on conflict (slug) do nothing;

alter table content_items add column if not exists
  work_kind_id uuid references work_kinds(id) on delete set null;
update content_items set work_kind_id = (select id from work_kinds where slug = 'edit')
  where work_kind_id is null;
create index if not exists content_items_kind_idx on content_items (work_kind_id);

alter table work_kinds enable row level security;  -- deny-by-default; service role only
