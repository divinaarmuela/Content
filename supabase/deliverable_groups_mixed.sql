-- ═══ Mixed-format deliverable groups — one card, many formats ═══
-- Idempotent. Run in the Supabase SQL editor. Safe to run more than once.
--
-- A deliverable group used to promise ONE format ("5 reels"). The owner wants
-- ONE card that can be created as a MIX — 2 reels + 2 carousels + 2 videos —
-- and can later take another reel or carousel. `planned` carries that mix:
--
--   [{ "type": "reel", "qty": 2 },
--    { "type": "carousel", "qty": 2 },
--    { "type": "video", "qty": 2 }]
--
-- `target` stays the SUM of the quantities and `content_type` stays the first
-- (primary) format, so a single-format group leaves `planned` null and behaves
-- exactly as before. The app tolerates this column being absent — until this
-- runs, every group is simply single-format. Nothing breaks by waiting.

alter table deliverable_groups
  add column if not exists planned jsonb;

comment on column deliverable_groups.planned is
  'Mixed-format promise: [{type,qty}] per format. target = sum(qty), content_type = first type. Null = single-format group (legacy behaviour).';
