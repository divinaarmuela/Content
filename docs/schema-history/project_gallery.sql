-- ═══ Project gallery: expandable homepage work rows ═══
-- Run once in the Supabase SQL editor. Safe to re-run (idempotent).

-- Gallery media for the expanded homepage row. Array order is display
-- order. Each entry is an image or video URL (the site renders <video>
-- for .mp4/.webm/.mov), same convention as card_media_url.
alter table projects add column if not exists gallery_urls text[] not null default '{}';

-- The client's real site, for the VISIT WEBSITE button in the expanded
-- row. Null = button hidden.
alter table projects add column if not exists website_url text;
