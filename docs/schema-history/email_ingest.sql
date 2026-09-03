-- ═══ Inbox lead ingestion ═══
-- Every scanned Gmail message is recorded here. The unique gmail_message_id
-- is the exactly-once guard: concurrent/overlapping scans collide on insert,
-- so a message can never be classified or lead-ified twice. Idempotent.

create table if not exists email_ingest_log (
  id               uuid        default gen_random_uuid() primary key,
  created_at       timestamptz default now() not null,
  gmail_message_id text        not null unique,
  mailbox          text        not null,
  from_email       text,
  subject          text,
  received_at      timestamptz,
  -- outcome of the scan
  status           text        not null default 'pending'
                   check (status in ('pending','lead_created','not_a_lead','skipped','error')),
  is_lead          boolean,
  confidence       numeric(3,2),
  reasoning        text,
  lead_id          uuid        references leads(id) on delete set null,
  error            text
);

create index if not exists email_ingest_log_status_idx on email_ingest_log (created_at desc);

-- provenance on leads: web_form (site) | email_ingest (inbox scanner)
alter table leads add column if not exists source text not null default 'web_form';

alter table email_ingest_log enable row level security;
