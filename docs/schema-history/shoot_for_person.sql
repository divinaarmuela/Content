-- WHO A SHOOT IS FOR, AND WHOSE PORTAL IT LANDS ON (the owner, 15 Sep 2026:
-- "when we create a brief, it's the client's business name picked, or their
-- name — this shows as the title in the client portal; if not there we type
-- it, which appears in contacts as their name; and we toggle show the
-- client name in the portal, or the person's, or both" — "then yea, it's a
-- separate portal too" — "the business portal would be separate").
--
-- A shoot for the business carries no person; a shoot for one of the
-- client's people carries that person. Each person gets a portal of their
-- own (client_contacts.share_token, minted on demand) showing only what was
-- made for them; the business portal shows only the business's own. The two
-- toggles decide what a shoot's plan is titled on a person's portal.
alter table batches add column if not exists for_contact_id uuid references client_contacts(id) on delete set null;
alter table batches add column if not exists portal_show_business boolean;
alter table batches add column if not exists portal_show_person boolean;
alter table client_contacts add column if not exists share_token uuid;
create unique index if not exists client_contacts_share_token_uidx on client_contacts (share_token) where share_token is not null;
