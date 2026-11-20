-- THE DISCOVERY FORM, SENT FROM A LEAD (the owner, 20 Nov 2026: "so we still need this??? how about in leads page are
-- we tracking client if they fill it out ... how can we keep track"). A potential client is a LEAD, not a client yet,
-- so their form hangs off the lead: `lead_id` is set and `client_id` is '' until they become a client, when the form
-- moves onto the new client (convert-lead). One discovery form per lead.
alter table intake_forms add column if not exists lead_id uuid;
create index if not exists intake_forms_lead_idx on intake_forms (lead_id);

alter table intake_forms drop constraint if exists intake_forms_template_key_check;
alter table intake_forms add constraint intake_forms_template_key_check
  check (template_key in ('one_off', 'launch', 'rebrand', 'ongoing', 'discovery'));
