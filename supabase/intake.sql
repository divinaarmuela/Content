-- ═══ Client intake form ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- `definition` is a FROZEN copy of the template taken at creation: editing a
-- master template in app/lib/intake-templates.ts must never change a form under
-- a client who is halfway through writing six hundred words into it. A super
-- admin may still edit one form's own questions, but only before the client
-- has started — see updateIntakeDefinition.

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

-- A client may hold several forms — an onboarding intake, then a separate brief
-- for a second piece of work. An earlier version of this file enforced one per
-- client with a unique index; drop it if that version already ran.
drop index if exists intake_forms_client_uidx;
create index if not exists intake_forms_client_idx on intake_forms (client_id, created_at desc);

-- the token is the credential, so it must be unguessable AND unique
create unique index if not exists intake_forms_token_uidx on intake_forms (token);

-- a human-readable name, so three forms on one client are tellable apart
alter table intake_forms add column if not exists title text not null default '';

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
