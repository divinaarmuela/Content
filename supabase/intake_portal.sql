-- Show a client's intake answers on their client portal, gated by a per-form
-- toggle. Adds one boolean to intake_forms; default false means every existing
-- form stays hidden until someone deliberately turns it on.
--
-- Idempotent: safe to run more than once. The app is written to tolerate this
-- column being ABSENT (every read degrades to "false" / "no tab"), so it can
-- deploy before this runs — running it only switches the feature on.

alter table intake_forms
  add column if not exists show_on_portal boolean not null default false;
