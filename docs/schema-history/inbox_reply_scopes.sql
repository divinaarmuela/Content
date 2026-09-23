-- ONE WAY TO CONNECT, READ AND REPLY (the owner, 23 Sep 2026: "so its easily connected again same way"):
-- the scopes Google granted when the mailbox was connected, so the app knows whether it may send from it.
alter table scan_mailboxes add column if not exists scopes text;
