-- ═══ Intake form notification recipients ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- Who gets emailed when a client submits an intake form. Two levels:
--   intake_settings.notify_emails    the agency-wide default
--   intake_forms.notify_emails       an override for one form
--
-- NULL on a form means "use the default". An EMPTY ARRAY is a real choice —
-- notify nobody for this one — which is why the column is nullable rather
-- than defaulting to '{}'.

create table if not exists intake_settings (
  id            int         primary key default 1 check (id = 1),
  notify_emails text[]      not null default '{}',
  updated_at    timestamptz not null default now(),
  updated_by    text
);

insert into intake_settings (id) values (1) on conflict (id) do nothing;

alter table intake_forms add column if not exists notify_emails text[];

alter table intake_settings enable row level security;
