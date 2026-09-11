-- DELIVER ONLY (the Team's Playbook: "Some clients post and schedule their
-- own after we have delivered the assets, example Bond Street"). A client
-- flagged here gets the finals to download on the portal once approved;
-- nobody on the team schedules them, and the card ends at Delivered.
alter table clients
  add column if not exists posts_own_content boolean not null default false;
