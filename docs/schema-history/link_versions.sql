-- EVERY CUT STAYS OPENABLE (the owner, 24 Sep 2026, of a card whose finished-edit link had been replaced
-- eight times: "where is the version 1 and version 2"). The card kept one link field, so each hand-in wrote
-- over the last and the cut the client had commented on could not be opened again. The history is kept here,
-- newest last, one entry per save.
alter table content_items add column if not exists link_versions jsonb;
