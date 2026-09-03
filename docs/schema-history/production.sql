-- ═══ Milestone 2: production workflow ═══
-- Batches, content items, versions, comments, approvals, scheduling,
-- monthly commitments, activity log. Idempotent — safe to re-run.
-- Depends on: website_cms.sql (clients), identity.sql (team_users).

-- ─── Status enum (doc 1 §4, nine statuses) ───
do $$ begin
  create type item_status as enum (
    'draft_uploaded', 'internal_review', 'revision_required', 'revision_complete',
    'client_review', 'client_changes_requested', 'approved_for_scheduling',
    'scheduled', 'published'
  );
exception when duplicate_object then null; end $$;

-- ─── Monthly commitments ───
-- unique (client, month, year): one commitment row per client-month by construction
create table if not exists monthly_commitments (
  id             uuid default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  client_id      uuid not null references clients(id) on delete cascade,
  month          int  not null check (month between 1 and 12),
  year           int  not null check (year between 2024 and 2100),
  reel_quota     int  not null default 0,
  carousel_quota int  not null default 0,
  story_quota    int  not null default 0,
  static_quota   int  not null default 0,
  other_quota    int  not null default 0,
  notes          text,
  unique (client_id, month, year)
);

-- ─── Batches (one shoot → many items) ───
create table if not exists batches (
  id          uuid default gen_random_uuid() primary key,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null,
  client_id   uuid not null references clients(id) on delete cascade,
  title       text not null,
  description text,
  shoot_date  date,
  month       int check (month between 1 and 12),
  year        int check (year between 2024 and 2100),
  owner_id    uuid references team_users(id) on delete set null
);
create index if not exists batches_client_idx on batches (client_id, year, month);

-- ─── Content items ───
create table if not exists content_items (
  id            uuid default gen_random_uuid() primary key,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null,
  client_id     uuid not null references clients(id) on delete cascade,
  batch_id      uuid references batches(id) on delete set null,
  title         text not null,
  content_type  text not null default 'reel'
                check (content_type in ('reel','carousel','story','static','video','other')),
  platform_targets text[] not null default '{}',
  status        item_status not null default 'draft_uploaded',
  owner_id      uuid references team_users(id) on delete set null, -- editor
  due_date      date,
  priority      text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  caption       text, -- caption/platform instructions for the scheduler
  client_approval_required boolean not null default true,
  -- denormalised for cheap board queries; maintained by the server engine
  current_version_number int not null default 0
);
-- the job handoff: where the raw footage lives and what the edit should be.
-- Without these an assigned editor has a title and a deadline but no assets.
alter table content_items add column if not exists raw_assets_url text;
alter table content_items add column if not exists brief text;
-- directly-uploaded source files: [{ "url": "...", "name": "..." }]
alter table content_items add column if not exists raw_assets jsonb not null default '[]'::jsonb;
create index if not exists content_items_board_idx  on content_items (client_id, status);
create index if not exists content_items_status_idx on content_items (status);
create index if not exists content_items_batch_idx  on content_items (batch_id);
create index if not exists content_items_owner_idx  on content_items (owner_id);

-- ─── Asset versions (append-only; every re-edit is a new row) ───
-- unique (item_id, version_number) is the race guard: two concurrent uploads
-- can't mint the same version — the loser retries with the next number.
create table if not exists asset_versions (
  id             uuid default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  item_id        uuid not null references content_items(id) on delete cascade,
  version_number int  not null,
  file_url       text not null default '', -- in-app upload (review surface)
  dropbox_url    text not null default '', -- internal master — never client-facing
  drive_url      text not null default '', -- optional client-facing link
  notes          text,
  uploaded_by    uuid references team_users(id) on delete set null,
  unique (item_id, version_number)
);
create index if not exists asset_versions_item_idx on asset_versions (item_id, version_number desc);

-- ─── Comments / change requests ───
create table if not exists item_comments (
  id            uuid default gen_random_uuid() primary key,
  created_at    timestamptz default now() not null,
  item_id       uuid not null references content_items(id) on delete cascade,
  parent_id     uuid references item_comments(id) on delete set null,
  author_id     uuid references team_users(id) on delete set null,
  visibility    text not null default 'internal' check (visibility in ('internal','client')),
  body          text not null,
  video_timestamp_sec int,
  assigned_to   uuid references team_users(id) on delete set null,
  resolved      boolean not null default false
);
create index if not exists item_comments_item_idx on item_comments (item_id, created_at);

-- ─── Approvals (decision history) ───
create table if not exists approvals (
  id            uuid default gen_random_uuid() primary key,
  created_at    timestamptz default now() not null,
  item_id       uuid references content_items(id) on delete cascade,
  batch_id      uuid references batches(id) on delete cascade,
  approval_type text not null check (approval_type in ('internal','client','scheduling')),
  decided_by    uuid references team_users(id) on delete set null,
  decision      text not null check (decision in ('approved','changes_requested')),
  notes         text,
  check (item_id is not null or batch_id is not null)
);
create index if not exists approvals_item_idx on approvals (item_id, created_at);

-- ─── Schedule entries (one per item per platform) ───
create table if not exists schedule_entries (
  id             uuid default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  item_id        uuid not null references content_items(id) on delete cascade,
  platform       text not null,
  scheduled_at   timestamptz,
  scheduler_id   uuid references team_users(id) on delete set null,
  tool_url       text,
  live_url       text,
  publish_status text not null default 'scheduled' check (publish_status in ('scheduled','published')),
  published_at   timestamptz,
  unique (item_id, platform)
);
create index if not exists schedule_entries_calendar_idx on schedule_entries (scheduled_at);

-- ─── Activity log (audit trail — doc 1 §6/§9) ───
create table if not exists workflow_activity (
  id          uuid default gen_random_uuid() primary key,
  created_at  timestamptz default now() not null,
  actor_id    uuid references team_users(id) on delete set null,
  client_id   uuid references clients(id) on delete set null,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  old_value   text,
  new_value   text,
  detail      text
);
create index if not exists workflow_activity_entity_idx on workflow_activity (entity_type, entity_id, created_at desc);
create index if not exists workflow_activity_client_idx on workflow_activity (client_id, created_at desc);

-- ─── updated_at triggers ───
drop trigger if exists batches_updated_at on batches;
create trigger batches_updated_at before update on batches
  for each row execute function set_updated_at();
drop trigger if exists content_items_updated_at on content_items;
create trigger content_items_updated_at before update on content_items
  for each row execute function set_updated_at();

-- ─── RLS: server-only access ───
alter table monthly_commitments enable row level security;
alter table batches             enable row level security;
alter table content_items       enable row level security;
alter table asset_versions      enable row level security;
alter table item_comments       enable row level security;
alter table approvals           enable row level security;
alter table schedule_entries    enable row level security;
alter table workflow_activity   enable row level security;
