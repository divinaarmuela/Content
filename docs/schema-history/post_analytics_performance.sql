-- ═══ How a post did — the summary the card reads ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- The owner's question, in their words: "when we post through the board we
-- want to see if anyone interacts with it or if they have gained followers
-- since this post." The per-post cache already holds the totals; this column
-- holds what the card draws on top of them — the daily timeline behind the
-- sparkline, the follower delta since the post went up (and, when there is a
-- later post, the delta until that one, so two posts a day apart do not both
-- claim the same gain), and the latest comments with who wrote them.
--
-- Computed by app/lib/post-performance-core.ts on every refresh, written
-- beside the numbers by the same upsert, and never read back to compute
-- anything: a wrong shaping is fixed by the next sweep, not by a migration.
alter table post_analytics
  add column if not exists performance jsonb;
