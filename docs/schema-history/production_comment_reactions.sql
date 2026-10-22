-- REACTIONS ON A COMMENT (the owner, 22 Oct 2026: "also in comments can u
-- please add reactions"). { [emoji]: team_user_id[] }, toggled one person's
-- one emoji at a time by POST /api/production/items/[id]/comments/[commentId]/react
-- (app/lib/comment-reactions-core.ts holds the allowed set and the toggle).
alter table item_comments add column if not exists reactions jsonb;  -- null until someone reacts (RTDB stores no empty object)
