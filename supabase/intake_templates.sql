-- ═══ Editable question templates ═══
-- Idempotent. Run in the Supabase SQL editor.
--
-- The four templates live in app/lib/intake-templates.ts. This table holds an
-- OVERRIDE per category, saved from the editor, so improving a question while
-- tailoring one client's form can carry to every form created afterwards.
--
-- Absent row = use the code default. That matters: it means the code is always
-- a working fallback, and deleting a row is how you undo a bad edit.
--
-- Forms already created are untouched by design — each freezes its own copy of
-- the definition, so a client halfway through never has questions change under
-- them.

create table if not exists intake_templates (
  key         text        primary key check (key in ('one_off','launch','rebrand','ongoing')),
  definition  jsonb       not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table intake_templates enable row level security;
