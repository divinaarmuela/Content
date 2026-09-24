-- ═══ Re-sending what timed out (24 Sep 2026) ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Jordan Wilson's 7 pm post: Instagram in thirty seconds, then Zernio's own upload to LinkedIn and TikTok
-- ran past its time limit and it gave up on both. A partial whose failures are transient is now re-sent by
-- the app, each network as its own job a few minutes apart (app/lib/publish-core.ts resendPlanFor).
alter table publish_jobs add column if not exists resend_of uuid references publish_jobs(id);
alter table publish_jobs add column if not exists resent_platforms jsonb;
create index if not exists publish_jobs_resend_of_idx on publish_jobs (resend_of);
