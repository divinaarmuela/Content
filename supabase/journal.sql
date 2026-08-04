-- ═══ Journal (blog) — CMS-managed posts ═══
-- Run once in the Supabase SQL editor. Idempotent — safe to re-run.
-- Mirrors the shape the site already renders from app/journal/journalData.ts,
-- so the hardcoded articles stay usable as a fallback until rows exist.

create table if not exists journal_posts (
  id           uuid        default gen_random_uuid() primary key,
  created_at   timestamptz default now() not null,
  updated_at   timestamptz default now() not null,

  slug         text        not null unique,
  title        text        not null,
  standfirst   text        not null default '',
  -- drives the topic rail on /journal; free text so a new topic needs no
  -- migration, exactly like project services
  category     text        not null default '',
  cover_url    text        not null default '',
  read_mins    int         not null default 3,
  -- a real date, so ordering is chronological rather than by a display string
  published_at date,
  featured     boolean     not null default false,

  -- [{ heading?, paragraphs: string[], callout? }] — the same section shape
  -- the article page already renders
  sections     jsonb       not null default '[]'::jsonb,

  sort_order   int         not null default 100,
  published    boolean     not null default false
);

-- newest first is the default read, and only published posts are public
create index if not exists journal_posts_published_idx
  on journal_posts (published_at desc nulls last) where published;

-- at most one featured post: a partial unique index makes a second one fail
-- loudly at the database instead of the page quietly picking whichever came
-- back first
create unique index if not exists journal_posts_single_featured
  on journal_posts ((featured)) where featured;

drop trigger if exists journal_posts_updated_at on journal_posts;
create trigger journal_posts_updated_at
  before update on journal_posts
  for each row execute function set_updated_at();

-- All access flows through the Next.js server (service role). Nothing for anon.
alter table journal_posts enable row level security;
