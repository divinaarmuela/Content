-- ═══ Shoot proposals ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- "Propose a shoot" from the Availability view: the team offers a client a
-- date, the client answers Yes/No on a token page (like the intake form),
-- and the answer marks the slot in the availability week. The token is the
-- only credential the client needs — unguessable, no login.

create table if not exists shoot_proposals (
  id            uuid primary key default gen_random_uuid(),
  token         uuid not null unique default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text,
  note          text,
  send_to       text not null,             -- the email the proposal went to
  status        text not null default 'pending'
                check (status in ('pending','accepted','declined','cancelled')),
  created_by    text,
  responded_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists shoot_proposals_time_idx on shoot_proposals (starts_at);

alter table shoot_proposals enable row level security;


