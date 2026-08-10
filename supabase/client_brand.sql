-- Brand guidelines per client, extracted once from uploaded documents and
-- stored structured. Idempotent; run by hand in the SQL editor.

create table if not exists client_brand (
  client_id  uuid primary key references clients(id) on delete cascade,
  updated_at timestamptz default now() not null,
  updated_by text not null default '',
  -- the structured profile: fonts, colors, logo rules, voice, imagery, rules
  profile    jsonb not null default '{}'::jsonb,
  -- every document ever scanned for it: [{filename, url, scanned_at}]
  docs       jsonb not null default '[]'::jsonb
);

alter table client_brand enable row level security;
