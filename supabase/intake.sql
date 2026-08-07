-- ═══ Client intake form ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- One form per client, sent once after the kickoff call. `definition` is a
-- FROZEN copy of the template taken at creation: editing a master template in
-- app/lib/intake-templates.ts must never change a form under a client who is
-- halfway through writing six hundred words into it.

create table if not exists intake_forms (
  id              uuid        primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  client_id       uuid        not null references clients(id) on delete cascade,
  template_key    text        not null check (template_key in ('one_off','launch','rebrand','ongoing')),
  -- frozen at creation; never rewritten from the template source
  definition      jsonb       not null,
  token           uuid        not null default gen_random_uuid(),
  status          text        not null default 'draft'
                              check (status in ('draft','sent','in_progress','submitted')),
  -- keyed by block id; a partial autosave merges rather than replaces
  answers         jsonb       not null default '{}'::jsonb,
  -- off by default: the answers name competitors and say where each has the
  -- edge, which is written for us, not for a shared inbox
  send_copy_to_client boolean not null default false,
  sent_at         timestamptz,
  -- recorded on first open, but does NOT advance status — "started" means typed
  first_opened_at timestamptz,
  submitted_at    timestamptz,
  reopened_at     timestamptz,
  created_by      uuid        references team_users(id) on delete set null
);

-- 'ongoing' was added after the first draft of this file. Re-stating the
-- constraint keeps a database where the earlier version already ran in step
-- with one where it never did.
alter table intake_forms drop constraint if exists intake_forms_template_key_check;
alter table intake_forms add constraint intake_forms_template_key_check
  check (template_key in ('one_off','launch','rebrand','ongoing'));

-- one form per client, enforced here rather than by the UI hiding a button
create unique index if not exists intake_forms_client_uidx on intake_forms (client_id);
create unique index if not exists intake_forms_token_uidx  on intake_forms (token);

-- A file block accepts several files and needs its own lifecycle, so uploads
-- are rows rather than entries inside `answers`.
create table if not exists intake_files (
  id          uuid        primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  form_id     uuid        not null references intake_forms(id) on delete cascade,
  block_id    text        not null,
  filename    text        not null,
  url         text        not null,
  size_bytes  bigint      not null default 0
);
create index if not exists intake_files_form_idx on intake_files (form_id, block_id);

-- deny-by-default, like every other table; the service role bypasses RLS and
-- browser code never touches these directly
alter table intake_forms enable row level security;
alter table intake_files enable row level security;
