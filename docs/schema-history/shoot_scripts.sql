-- SCRIPTS ON THE SHOOT PLAN (13 Sep 2026, the owner's "TOF SCRIPTS" doc):
-- one block per video — title, presenter, voiceover, hook, prompts, visual
-- direction, purpose, reference links — kept beside the plain "Script or
-- talking points" text. Sanitised by app/lib/script-core.ts.
alter table batches add column if not exists scripts jsonb;
