-- ═══ Lead auto-ingest: prospect status + provenance ═══
-- Verified-company leads auto-create clients as 'prospect'; promote to
-- 'active' manually when they sign. Idempotent.

alter table clients drop constraint if exists clients_status_check;
alter table clients add constraint clients_status_check
  check (status in ('prospect','active','paused','archived'));

alter table clients add column if not exists website text;
-- where this client row came from: manual | lead_convert | auto_ingest
alter table clients add column if not exists source text not null default 'manual';
