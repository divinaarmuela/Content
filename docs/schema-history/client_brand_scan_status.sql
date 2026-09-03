-- Brand scan progress, so the panel can show a scan that is still running
-- after a reload — the work lives on the server, not in the tab that started
-- it. Idempotent; run by hand in the SQL editor.

alter table client_brand add column if not exists scan_status text;          -- queued | scanning | done | failed
alter table client_brand add column if not exists scan_done int;
alter table client_brand add column if not exists scan_total int;
alter table client_brand add column if not exists scan_message text;
alter table client_brand add column if not exists scan_started_at timestamptz;
