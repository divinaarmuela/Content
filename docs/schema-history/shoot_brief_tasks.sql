-- ═══ Shoot-brief tasks + notification read-state ═══
-- Idempotent. Run in the Supabase SQL editor BEFORE deploying the build.
--
-- A shoot brief is now also a TASK on the board: an item of kind
-- 'shoot_brief' that flows the normal review pipeline (relabelled: Shoot
-- brief → … → Shoot booked) and auto-creates its shoot. The brief itself is
-- written on our brief page or linked from Milanote — either satisfies review.

-- 1. the kind, with a FIXED uuid so the index predicate below is a constant
insert into work_kinds (id, slug, name, default_roles, uses_media, color, sort_order)
values ('c0a80000-0000-4000-8000-000000000b21','shoot_brief','Shoot brief',
        array['account_manager'], false, 'sky', 5)
on conflict (slug) do nothing;

-- 2. at most ONE brief task per shoot — enforced structurally, never check-then-write
create unique index if not exists content_items_one_brief_per_batch_uidx
  on content_items (batch_id)
  where work_kind_id = 'c0a80000-0000-4000-8000-000000000b21' and batch_id is not null;

-- 3. the external brief link (Milanote or anywhere; optional per the owner)
alter table content_items add column if not exists brief_url text;

-- 4. notification read-state for the in-app bell
alter table notification_log add column if not exists read_at timestamptz;
create index if not exists notification_log_unread_idx
  on notification_log (recipient_id) where read_at is null;
