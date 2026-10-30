-- ═══ Comments on a shoot proposal ═══
-- Idempotent.
--
-- The client can say more than Yes or No on a proposed shoot date ("can we do Thursday instead?") — the owner,
-- 30 Oct 2026. Each comment is { id, at, body }; the team reads them on the Proposals page and is emailed each one.
alter table shoot_proposals add column if not exists comments jsonb;
