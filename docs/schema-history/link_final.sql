-- THE FINISHED EDIT IS MARKED (the owner, 14 Sep 2026: the quality reviewer's
-- card showed the editor's submitted link only as "the folder", under "Files
-- to work from"). The link route writes true for a link pasted as the finished
-- edit (the editor's "Your finished edit" box) and false for a folder to work
-- from; a row from before the mark is read by card-link-core.finishedEditOf,
-- which counts its link as the work when it is not also the folder.
alter table content_items add column if not exists link_final boolean;
