create table if not exists content_applications (
  id             uuid        default gen_random_uuid() primary key,
  created_at     timestamptz default now() not null,
  first_name     text        not null,
  last_name      text        not null,
  email          text        not null,
  phone          text        not null,
  business       text        not null,
  industry       text,
  model_interest text,
  content_needed text,
  budget         text,
  timeline       text
);

alter table content_applications enable row level security;

-- Allow the anon key (used by the server-side API route) to insert rows.
-- No select/update/delete policy = nobody can read or modify via the anon key.
create policy "allow_anon_insert"
  on content_applications
  for insert
  to anon
  with check (true);
