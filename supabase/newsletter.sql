-- Newsletter subscribers, collected by the journal "Field notes" form.
-- Idempotent; run by hand in the Supabase SQL editor.

create table if not exists newsletter_subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  source     text not null default 'journal',
  created_at timestamptz not null default now()
);

-- Deny-by-default like every other table; only the service role writes.
alter table newsletter_subscribers enable row level security;
