-- The editable brand profile per client: seeded from the guidelines scan
-- (client_brand.profile) the first time it is read, then owned by the team.
-- A later scan proposes additions; it never writes here directly.
-- Idempotent; run by hand in the SQL editor.

alter table clients add column if not exists brand_profile jsonb;
alter table clients add column if not exists brand_profile_updated_at timestamptz;
alter table clients add column if not exists brand_profile_updated_by text;
