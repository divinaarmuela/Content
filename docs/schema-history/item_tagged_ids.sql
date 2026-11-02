-- EVERYONE TAGGED ON A CARD (the owner, 3 Nov 2026: "we can tag any team member in the comments and anyone that's
-- tagged from now on will have that card also in their page … if client comments they would receive it too and they
-- can delete and also do anything, move cards etc"). Every team member "@"-tagged in a card's comments, kept on the
-- card: it opens the card for them (production-access / scope-client), gives them the holder's hats on it
-- (workflow-core.actingRoles — move it, hand it on, delete it as its holder could), puts it on their Editor or Designer
-- board, and sends them the client's comments. Only ever added to.
alter table content_items add column if not exists tagged_ids jsonb;
