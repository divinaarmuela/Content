-- ═══ Browser-playable previews for camera video ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- ── Why this table exists ──
--
-- A camera .mov is not a web video. Three separate facts make one unplayable
-- (see app/lib/video-probe-core.ts for the byte-level detail): the `moov`
-- index written after the picture, so the browser must download all 184 MB
-- before frame one; HEVC, which Chrome and Edge will not decode; ProRes,
-- which nothing decodes. SafeVideo turned the resulting spinner into words,
-- which was honest but still left the reviewer unable to watch the cut.
--
-- Cloudflare Stream re-encodes the original into HLS that every browser
-- plays. This table is the join between "a file in R2" and "the Stream video
-- made from it", and it is the ONLY record of that: Stream itself is keyed by
-- its own uid and cannot be asked "do you already have this URL?".
--
-- ── Why source_url is unique ──
--
-- The insert is the claim, exactly like drive_files.(source_url, target) and
-- email_ingest_log.gmail_message_id. Two uploads of the same file, a retry, a
-- webhook landing on top of the 30-minute sweep — all race to insert, one
-- wins, and the losers know immediately they have nothing to do. Without it
-- the same 2 GB master would be encoded two or three times, and Stream bills
-- per minute stored: duplicates are a bill, not just a mess.
--
-- Nothing here ever touches the original. The R2 object stays exactly where
-- it is and remains what the Drive mirror copies and what Instagram posts;
-- this is a PREVIEW beside it, never a replacement for it.

create table if not exists video_previews (
  id            uuid primary key default gen_random_uuid(),
  -- the R2 (or Supabase Storage) URL the bytes were pulled from. The natural
  -- key: every player, every sweep and every webhook finds a row by this.
  source_url    text not null unique,
  -- Cloudflare's id for the encode. Null in the instant between claiming the
  -- row and Stream accepting the copy request — which is exactly the window a
  -- retry needs to recognise so it can take the job back.
  stream_uid    text,
  state         text not null default 'queued',
  -- verbatim from Cloudflare, not rebuilt from parts: the customer subdomain
  -- is per account and the URL shape is theirs to change.
  playback_hls  text,
  thumbnail_url text,
  duration_sec  numeric,
  width         int,
  height        int,
  -- status.errorReasonText, shown to the team and never to a client
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- the state vocabulary as a NAMED constraint, so the next state is two
-- statements rather than a migration nobody dares run (same reasoning as
-- drive_files_target_check)
alter table video_previews drop constraint if exists video_previews_state_check;
alter table video_previews add  constraint video_previews_state_check
  check (state in ('queued','processing','ready','error'));

-- "which rows is the poller still waiting on" and "how did the last week go",
-- which are the settings card's two questions and the cron's one
create index if not exists video_previews_state_idx on video_previews (state, updated_at);

-- deny-by-default like every other table here: only the service role reads
-- it, and the browser never touches Supabase directly
alter table video_previews enable row level security;
