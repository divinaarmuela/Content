-- ═══ Analytics for posts published BY HAND ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- A scheduler who posts on Instagram themselves and then pastes the live URL
-- onto the item card produces a published item with NO publish job — so
-- nothing in this app ever held a provider post id for it, and the analytics
-- cache had no way to find its numbers. The client's portal showed a link and
-- nothing else, for a post that performed exactly like every other one.
--
-- The provider's own /analytics list DOES carry those posts (isExternal:true,
-- with their platformPostUrl and _id), so the join is the URL. These two
-- columns are what that join needs to be honest about itself.

-- ── where a row's numbers came from ──────────────────────────────────────
-- 'provider' — we published it, and the job's provider_post_id is the key.
-- 'external' — a human published it and we matched their link to a post the
--              platform already knew about.
-- The default is 'provider' so every row written before this migration keeps
-- meaning what it meant, and the refresh cron needs no back-fill.
alter table post_analytics
  add column if not exists source text not null default 'provider';

-- the cron's external pass: "which external rows are due a refresh?"
create index if not exists post_analytics_source_idx on post_analytics (source);

-- ── did we look, and what happened? ──────────────────────────────────────
-- Without this the dashboard card cannot tell "we have not looked yet" from
-- "we looked and the link matched nothing", and it would have to accuse the
-- scheduler of a bad link during the seconds before the first lookup finishes.
--   null        — nothing has been attempted (an ordinary published post)
--   'searching' — a lookup is in flight or the provider was unreachable
--   'matched'   — a provider post was found; post_analytics holds its numbers
--   'not_found' — we looked and nothing on the platform matched this link
alter table schedule_entries
  add column if not exists external_match_state text;
