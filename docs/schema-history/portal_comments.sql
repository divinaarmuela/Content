-- ═══ Comment threads on shoots (client portal + brief page) ═══
-- Idempotent. Run in the Supabase SQL editor. Item comments already exist
-- (item_comments); this adds the matching thread for shoots, so a client can
-- talk on a shared shoot plan and the team answers from the brief page.

create table if not exists batch_comments (
  id          uuid default gen_random_uuid() primary key,
  created_at  timestamptz default now() not null,
  batch_id    uuid not null references batches(id) on delete cascade,
  author_id   uuid references team_users(id) on delete set null,
  body        text not null
);
create index if not exists batch_comments_batch_idx on batch_comments (batch_id, created_at);
alter table batch_comments enable row level security;
