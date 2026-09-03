-- Which schedulers an approved item was handed to.
-- Empty array = not handed to anyone yet: visible to every scheduler so an
-- un-assigned item can never become invisible to the whole team.
alter table content_items
  add column if not exists scheduler_ids jsonb not null default '[]'::jsonb;
