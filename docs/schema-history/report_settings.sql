-- ═══ Leads report settings ═══
-- Singleton config row for the monthly leads report. Idempotent.
create table if not exists report_settings (
  id            text        primary key default 'leads_report',
  updated_at    timestamptz default now() not null,
  enabled       boolean     not null default false,
  -- who receives the PDF
  recipients    text[]      not null default '{}',
  -- day of month the automatic report goes out (1–28 to exist in every month)
  send_day      int         not null default 1 check (send_day between 1 and 28),
  -- ignore data before this date (e.g. start counting from go-live)
  data_from     date,
  -- last automatic send, guards against double-sends within a month
  last_sent_for text
);

insert into report_settings (id) values ('leads_report') on conflict (id) do nothing;

drop trigger if exists report_settings_updated_at on report_settings;
create trigger report_settings_updated_at before update on report_settings
  for each row execute function set_updated_at();

alter table report_settings enable row level security;
