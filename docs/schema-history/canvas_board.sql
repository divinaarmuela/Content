-- ═══ Brief canvas: freeform card board per shoot ═══
-- Idempotent. Run in the Supabase SQL editor BEFORE deploying the build.
alter table batches add column if not exists canvas_cards jsonb not null default '[]'::jsonb;
