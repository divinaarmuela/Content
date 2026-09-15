-- A CLIP'S OWN REVIEW PAGE (the owner, 15 Sep 2026: "once a video is
-- clicked it opens a new page with the video on the left and the comments
-- on the right — comments mention the timestamp, and on the video there is
-- a highlight circle at that timestamp so we can see it").
--
-- A comment already carries video_timestamp_sec; it now also says WHICH
-- file it is about, so a card with six clips keeps six conversations.
alter table item_comments add column if not exists video_file_id text;
alter table item_comments add column if not exists video_file_name text;
