-- THE CLIENT APPROVES THIS PLAN FIRST (the owner, 2 Nov 2026: "an automatic move to share to team involved after all
-- steps are done and names of teams are added (and if no need for client approval)"). A finished plan with its people
-- named goes to the team by itself (shoot-sop-core.autoShareReady); this tick on the shoot page holds it until the
-- client approves it on their portal.
alter table batches add column if not exists client_approval_needed boolean;
