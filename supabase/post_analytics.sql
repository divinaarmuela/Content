-- ═══ Per-post analytics ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One row per LIVE POST, keyed on the provider's own post id. The numbers are
-- a cache of what the platform reports: refreshed on a schedule, never the
-- source of truth, and safe to drop and rebuild.
--
-- Why a table at all, rather than asking the provider on every page view: the
-- client portal is a public share link that anyone may open at any time, and
-- the provider's per-post endpoint takes hundreds of milliseconds per post.
-- A portal with a dozen published posts would be a dozen serial round trips
-- before the first pixel. The cron fills this in; the page reads it.

create table if not exists post_analytics (
  id                 uuid        primary key default gen_random_uuid(),
  -- the content item this post came from, when it came from one. Posts made
  -- directly on the platform have analytics too and no item.
  item_id            uuid        references content_items(id) on delete cascade,
  publish_job_id     uuid,
  -- the provider's post _id — the join key to everything, and unique so a
  -- refresh updates the row instead of appending a second one
  provider_post_id   text        not null unique,
  platform           text,
  platform_post_url  text,
  views              bigint,
  reach              bigint,
  impressions        bigint,
  likes              bigint,
  comments           bigint,
  shares             bigint,
  saves              bigint,
  engagement_rate    numeric,
  -- the provider's own readiness word: 'pending' means the platform has not
  -- published the numbers yet, which is a different thing from zero
  sync_status        text,
  published_at       timestamptz,
  synced_at          timestamptz not null default now(),
  -- the whole provider payload, so a new metric can be surfaced without a
  -- migration and a wrong shaping can be re-derived
  raw                jsonb       not null default '{}'::jsonb
);

create index if not exists post_analytics_item_idx on post_analytics (item_id);
create index if not exists post_analytics_job_idx  on post_analytics (publish_job_id);
-- the cron's own query: "which rows are stale?"
create index if not exists post_analytics_synced_idx on post_analytics (synced_at);

-- Deny by default, like every other table. Only the service role reads this;
-- the portal reaches it through the server, never from the browser.
alter table post_analytics enable row level security;
