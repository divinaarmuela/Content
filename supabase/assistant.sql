-- Assistant chat history and per-user behaviour. Idempotent; run by hand in
-- the Supabase SQL editor like every other migration here.

create table if not exists assistant_chats (
  id            uuid primary key,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null,
  clerk_user_id text not null,
  title         text not null default 'New chat',
  -- the full UIMessage[] for the conversation, exactly as the SDK shapes it.
  -- One row per chat, replaced on every completed response: at this scale a
  -- messages-per-row table buys nothing but joins.
  messages      jsonb not null default '[]'::jsonb
);

create index if not exists assistant_chats_owner_idx
  on assistant_chats (clerk_user_id, updated_at desc);

-- Per-user behaviour: extra standing instructions appended to the assistant's
-- system prompt for that person. Keyed by Clerk user id; email kept for the
-- settings page so a super admin sees who they are editing.
create table if not exists assistant_prefs (
  clerk_user_id text primary key,
  email         text not null default '',
  instructions  text not null default '',
  updated_at    timestamptz default now() not null,
  updated_by    text not null default ''
);

-- RLS deny-by-default like every table: the browser never touches these,
-- only the server with the service role.
alter table assistant_chats enable row level security;
alter table assistant_prefs enable row level security;
