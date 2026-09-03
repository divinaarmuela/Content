-- ═══ View-only client share links ═══
-- Each client gets an unguessable token for a read-only portal view
-- (/portal/<token>). Rotate by regenerating. Idempotent.
alter table clients add column if not exists share_token uuid not null default gen_random_uuid();
create unique index if not exists clients_share_token_uidx on clients (share_token);
