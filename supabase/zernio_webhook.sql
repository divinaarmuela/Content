-- ═══ Provider webhooks ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One row per webhook we have registered with a provider, so "Enable instant
-- post updates" can be pressed twice without creating a second registration
-- (which would deliver every event twice) and so the signing secret survives a
-- redeploy.
--
-- The secret is the thing that proves a delivery really came from the
-- provider. It is stored ENCRYPTED (aes-256-gcm, app/lib/secret-box.ts, keyed
-- by CREDENTIALS_KEY which lives only in the environment) — a database dump
-- must not hand someone the ability to mark any client's post published.
--
-- Setting ZERNIO_WEBHOOK_SECRET in the environment instead is a complete
-- alternative: the handler accepts either, and this table simply stays empty.

create table if not exists provider_webhooks (
  id                uuid        primary key default gen_random_uuid(),
  provider          text        not null default 'zernio',
  -- the provider's own id for the registration, used to UPDATE rather than
  -- create a duplicate next time
  provider_hook_id  text,
  url               text        not null,
  events            jsonb       not null default '[]'::jsonb,
  secret_encrypted  text,
  active            boolean     not null default true,
  registered_by     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One live registration per provider+URL. This is what makes re-registering an
-- update instead of a duplicate — a check-then-insert would race with itself.
create unique index if not exists provider_webhooks_provider_url_idx
  on provider_webhooks (provider, url);

create index if not exists provider_webhooks_active_idx
  on provider_webhooks (provider, active);

-- deny-by-default like every other table; only the service role reads this
alter table provider_webhooks enable row level security;
