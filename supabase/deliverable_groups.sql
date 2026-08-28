-- ═══ Deliverable groups — "5 reels" as ONE card that fills up ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Creating "5 reels" used to make five titled items ("… 01" … "… 05") and five
-- cards on the board before anyone had edited a frame. The owner wants one
-- card per TYPE that fills up — "Reels · 2 of 5" — driven by the quantity
-- entered when the job is created.
--
-- A group is presentation, not a new unit of delivery: the client's agreement
-- still counts PUBLISHED items (agreement-core), the portal still shows
-- published pieces, and an item without a group behaves exactly as before.
-- The group only says how many pieces were promised and gathers the ones
-- made so far under one card.

create table if not exists deliverable_groups (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id) on delete cascade,
  -- the shoot the pieces will come from, when there is one
  batch_id     uuid references batches(id) on delete set null,
  content_type text not null default 'reel',
  title        text not null,
  -- how many pieces were promised — the "of 5"
  target       int  not null default 1 check (target between 1 and 100),
  -- the kind of work the pieces are (null = a plain content item). A TASK
  -- group ("5 competitor write-ups") lives on the Production board; an asset
  -- group lives on the Editor board — the kind is what tells them apart.
  work_kind_id uuid references work_kinds(id) on delete set null,
  created_by   uuid references team_users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- idempotent add for a table created before the column existed
alter table deliverable_groups
  add column if not exists work_kind_id uuid references work_kinds(id) on delete set null;

-- deny-by-default like every other table: the browser never touches Supabase
-- directly, and the service-role key bypasses RLS server-side
alter table deliverable_groups enable row level security;

-- an item may belong to one group; deleting the group frees its items rather
-- than deleting work someone already edited
alter table content_items
  add column if not exists group_id uuid references deliverable_groups(id) on delete set null;

create index if not exists content_items_group_id_idx on content_items (group_id)
  where group_id is not null;
create index if not exists deliverable_groups_client_idx on deliverable_groups (client_id);

comment on table deliverable_groups is
  'One promised batch of same-type pieces ("5 reels") shown as a single filling card. Presentation only: agreements count published items, never groups.';
