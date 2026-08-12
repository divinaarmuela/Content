-- Invite requests for The Room (events page). Idempotent; run by hand in the
-- Supabase SQL editor.

create table if not exists room_invite_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null unique,
  about      text,          -- "what do you do" — the curation signal
  created_at timestamptz not null default now()
);

-- Deny-by-default like every other table; only the service role writes.
alter table room_invite_requests enable row level security;
