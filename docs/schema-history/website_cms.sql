-- ═══ Website CMS: master client registry, case study projects, asset library ═══
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).

-- Master client registry. One row per client — the website case studies,
-- the dashboard, and (later) client portal logins all key off this table.
create table if not exists clients (
  id            uuid        default gen_random_uuid() primary key,
  created_at    timestamptz default now() not null,
  name          text        not null,
  slug          text        not null unique,
  industry      text,
  contact_name  text,
  email         text,
  phone         text,
  -- link a Clerk user here to give this client dashboard access later
  clerk_user_id text,
  status        text        default 'active' not null, -- active | paused | archived
  notes         text
);

-- Website case studies. Everything the public site renders for a project.
create table if not exists projects (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null,
  client_id      uuid        references clients(id) on delete set null,
  slug           text        not null unique,
  name           text        not null,
  industry       text        not null default '',
  tag            text        not null default '',
  services       text[]      not null default '{}',
  description    text        not null default '',
  -- media slots: card = homepage row thumb + work grid; hero = case page top.
  -- either can be an image or a video URL (the site renders <video> for
  -- .mp4/.webm/.mov). Portrait or landscape both work — the site letterboxes
  -- with object-fit: cover.
  card_media_url text        not null default '',
  hero_media_url text        not null default '',
  result         text,
  challenge      text[]      not null default '{}', -- paragraphs
  approach       text[]      not null default '{}',
  outcome        text[]      not null default '{}',
  sort_order     int         not null default 100,
  published      boolean     not null default false
);

-- Asset library: every file uploaded through the dashboard, so uploads are
-- reusable and traceable even when not currently assigned to a project slot.
create table if not exists assets (
  id          uuid        default gen_random_uuid() primary key,
  created_at  timestamptz default now() not null,
  client_id   uuid        references clients(id)  on delete set null,
  project_id  uuid        references projects(id) on delete set null,
  kind        text        not null default 'image',    -- image | video
  orientation text,                                     -- portrait | landscape | square
  purpose     text,                                     -- card | hero | gallery | general
  url         text        not null,
  alt         text
);

-- ─── Row level security ───
-- The Next.js server uses the service role key (bypasses RLS). The anon key
-- may only read published projects and assets — nothing else.
alter table clients  enable row level security;
alter table projects enable row level security;
alter table assets   enable row level security;

drop policy if exists "anon_read_published_projects" on projects;
create policy "anon_read_published_projects"
  on projects for select to anon using (published = true);

drop policy if exists "anon_read_assets" on assets;
create policy "anon_read_assets"
  on assets for select to anon using (true);

-- ─── Storage bucket for website media ───
insert into storage.buckets (id, name, public)
values ('website-assets', 'website-assets', true)
on conflict (id) do nothing;

drop policy if exists "public_read_website_assets" on storage.objects;
create policy "public_read_website_assets"
  on storage.objects for select
  using (bucket_id = 'website-assets');

-- updated_at maintenance
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row execute function set_updated_at();
