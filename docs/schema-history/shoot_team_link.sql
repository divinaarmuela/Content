-- A shoot's link for the team, no sign-in (the owner, 23 Nov 2026): the brief, the board and the comments,
-- for editors and crew who have no login. One token per shoot; cleared, the page goes dark. app/lib/shoot-share-core.ts
alter table batches add column if not exists team_share_token text;
