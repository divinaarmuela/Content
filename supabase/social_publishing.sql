-- ═══ Social publishing ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One provider profile per client, so a client's connected accounts are
-- isolated from every other client's under a single API key.

alter table clients add column if not exists social_profile_id text;

create table if not exists social_accounts (
  id                  uuid        primary key default gen_random_uuid(),
  client_id           uuid        references clients(id) on delete cascade,
  platform            text        not null,
  -- the provider's account _id; unique so a re-sync updates rather than duplicates
  provider_account_id text        not null unique,
  name                text,
  username            text,
  avatar_url          text,
  active              boolean     not null default true,
  connected_at        timestamptz not null default now(),
  last_synced_at      timestamptz not null default now()
);

create index if not exists social_accounts_client_idx on social_accounts (client_id, platform);

-- One row per publish attempt against one content item.
--
-- status is the exactly-once gate: a job moves queued → publishing only via a
-- conditional update, so two workers can never both send it. request_id is the
-- provider's x-request-id, stored BEFORE the call and reused on retry, so a
-- retry inside the provider's replay window returns the original post instead
-- of creating a second one.
create table if not exists publish_jobs (
  id                uuid        primary key default gen_random_uuid(),
  client_id         uuid        references clients(id) on delete set null,
  content_item_id   uuid,
  schedule_entry_id uuid,
  caption           text        not null default '',
  media             jsonb       not null default '[]'::jsonb,
  targets           jsonb       not null default '[]'::jsonb,
  scheduled_for     timestamptz,
  timezone          text        not null default 'Australia/Melbourne',
  status            text        not null default 'queued'
                    check (status in ('queued','publishing','published','duplicate','failed','cancelled')),
  request_id        uuid        not null default gen_random_uuid(),
  provider_post_id  text,
  permalink         text,
  error             text,
  attempts          int         not null default 0,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz
);

create index if not exists publish_jobs_due_idx on publish_jobs (status, scheduled_for);
create index if not exists publish_jobs_client_idx on publish_jobs (client_id, created_at desc);

-- A content item must not be queued twice while a job for it is still live.
-- Partial unique index: only one non-terminal job per content item at a time.
create unique index if not exists publish_jobs_one_live_per_item
  on publish_jobs (content_item_id)
  where content_item_id is not null and status in ('queued','publishing');

alter table social_accounts enable row level security;
alter table publish_jobs    enable row level security;
