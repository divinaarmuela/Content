-- ═══ Webhook deliveries ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One row per event the provider has delivered to us. It does two jobs, and
-- the second is the reason it is a table rather than a log line:
--
--   1. It is the IDEMPOTENCY KEY for every webhook. Zernio delivery is
--      explicitly at-least-once — up to 7 attempts with exponential backoff —
--      so the same event arrives more than once as a matter of routine. The
--      unique index on (provider, provider_event_id) turns "have I already
--      done this?" into an INSERT that either wins or does not, with no
--      check-then-write race in between. Handlers that mutate a row still
--      carry their own conditional UPDATE; this is the belt for events (a new
--      comment, a notification) where there is no status to guard on.
--
--   2. It is what the Settings → Integrations card reads to say "Instant
--      updates: on · last delivery 2 min ago · 14 events today". Before this,
--      "on" meant a registration row existed — which says the button was
--      pressed, not that anything has ever arrived. A webhook that was
--      registered against the wrong URL, or auto-disabled by the provider
--      after 10 consecutive failures, looked identical to a working one.
--
-- Deliberately small. It is not an event archive: the payload is not stored
-- (it can carry a client's DM text, and it is already retained for 30 days at
-- the provider, where the logs endpoint can replay it), only what the event
-- was, when it landed, and whether we did something about it.

create table if not exists webhook_deliveries (
  id                uuid        primary key default gen_random_uuid(),
  provider          text        not null default 'zernio',
  event             text        not null,
  -- the provider's own stable event id (`payload.id` / `X-Zernio-Event-Id`).
  -- Retries of one event reuse it; that is what makes it a dedupe key.
  provider_event_id text        not null,
  received_at       timestamptz not null default now(),
  -- did we ACT on it, or merely acknowledge it? An unhandled row is not an
  -- error — most of the event list is subscribed to so that it shows up here
  -- rather than because a screen depends on it yet.
  handled           boolean     not null default false,
  note              text
);

-- The claim. A repeat delivery loses this insert and does nothing.
create unique index if not exists webhook_deliveries_event_idx
  on webhook_deliveries (provider, provider_event_id);

-- The card's own query: "what has arrived lately?"
create index if not exists webhook_deliveries_recent_idx
  on webhook_deliveries (provider, received_at desc);

-- deny-by-default like every other table; only the service role reads this
alter table webhook_deliveries enable row level security;
