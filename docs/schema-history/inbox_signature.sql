-- A SIGNATURE UNDER EVERY REPLY (the owner, 23 Sep 2026: "replying from hello can be shown as the signature in the bottom"):
-- the mailbox's signature, kept here and appended to replies sent from the conversation page.
alter table scan_mailboxes add column if not exists signature text;
