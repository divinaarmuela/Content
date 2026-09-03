-- ═══ Content Register + click tracking (Attribution Phase 1) ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Every piece of MD Media content becomes a registered asset (clause 8.6):
-- auto-created when a post publishes through the scheduler or a Zernio
-- webhook announces it, or added by hand for anything else (printed QR,
-- offline codes). Each asset carries a tracked /go/<slug> link whose clicks
-- are logged server-side — MD Media's own tracking records, the primary
-- evidence under clause 9.4.

create table if not exists content_assets (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  title            text not null,
  platform         text,                    -- instagram / facebook / tiktok / …
  slug             text not null unique,    -- the /go/<slug> tracked link
  dest_url         text,                    -- where the tracked link sends people (defaults to the client's website)
  post_url         text,                    -- the live post's permalink, once known
  provider_post_id text unique,             -- Zernio's id — dedupes auto-registration
  source           text not null default 'manual'
                   check (source in ('published','external','manual')),
  offer_code       text,                    -- "mention RENO10" — offline attribution
  keyword          text,                    -- comment/DM keyword (Phase 2)
  published_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists content_assets_client_idx on content_assets (client_id, created_at desc);

create table if not exists asset_clicks (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references content_assets(id) on delete cascade,
  click_id   text not null unique,          -- minted per click; carried to the destination as mdm_click
  referrer   text,
  user_agent text,
  clicked_at timestamptz not null default now()
);

create index if not exists asset_clicks_asset_idx on asset_clicks (asset_id, clicked_at desc);

alter table content_assets enable row level security;
alter table asset_clicks enable row level security;
