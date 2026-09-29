# Post stage migration — dry run

Run dry run at 2026-09-29T01:58:05.000Z. Read from the live database (NEXT_PUBLIC_FIREBASE_DATABASE_URL), /mdm/tables.

Nothing was written to the database. This is what `--write` would do, row by row. It was made by `scripts/migrate-post-stage.mjs` from a read of the live tables.

## Summary

- Posts read: 68. Mapped: 68. Not mapped: 0.
- New stages: cancelled 39, posted 19, draft 7, with_client 2, quality_check 1.
- Posts whose card was deleted (source_deleted): 46.
- Rows --write would write: 68 posts, 23 frozen versions (v1, from migration), 68 events, 9 schedule rows, 6 edit cards.
- Rules used: M1 20, M11 21, M2 19, M5 2, M6 2, M7 2, M8 1, M9 1.

## Choices the migration makes that SPEC §6 does not spell out

- A frozen version 1 (marked "from migration") is written for every post it puts in Quality check, With client, Ready to post, Booked in or Posted, and for a post that was sent and then had a change asked (M9). The new rules check the version a person saw against `sent_version`, and booking needs `approval.version` to equal it, so these posts need a version 1 to act on.
- Who approved: the post's own `approved_by` first, else the card's last "posting approved" record before the first job. Their role is read from team_users. A role that cannot approve a post (a scheduler) is not carried over, and the post says so.
- Approval steps: a card marked client-required becomes "team then client" on its post; one marked not required becomes "team only". Otherwise the client's own default applies.
- A draft whose time has already passed has its time cleared (the spec names e2d47057; the same rule is used for every draft). Its frozen version keeps the old time.
- A post the client asked to change (M9) keeps the card's send as `last_client_send`, so the client's page says "Thanks — we have your note".
- The old fields (`status`, `approved_by`, `client_sent`…) are left in place by `--write`. Only `--drop-legacy` removes them.

## Rows it cannot map

None. Every post gets a stage.

## Posts that need a person to look

- **d5830a61** (100 Hundred Million Group) → posted: Approved by c3e52e7e, whose role (scheduler) cannot approve a post, so no approval is carried over.
- **b2ce98f8** (100 Hundred Million Group) → posted: No live link kept for Instagram: none on record belongs to that network.
- **01444e51** (100 Hundred Million Group) → posted: No live link kept for Instagram: none on record belongs to that network.
- **9dfc706e** (100 Hundred Million Group) → posted: No live link kept for TikTok and Instagram: none on record belongs to that network.
- **34adf560** (100 Hundred Million Group, "Event Spaces 1") → posted: No live link kept for TikTok: none on record belongs to that network.
- **84f9420e** (100 Hundred Million Group, "images") → posted: No live link kept for Instagram: none on record belongs to that network.
- **b7f6a5ef** (MD Media, "FAV MD MEDIA ADS THIS WEEK") → draft: It has no channels chosen yet.
- **09be0c91** (Alia Fragrance, "alia is worn in layers") → draft: It has no channels chosen yet.
- **cf5eefcb** (Alia Fragrance, "more than one bottle. more than one step.") → draft: It has no channels chosen yet.
- **a067daa0** (Alia Fragrance, "powder for the final touch") → draft: It has no channels chosen yet.
- **ff85fac3** (Jordan Wilson, "Jordan 1") → posted: Re-send jobs 54f9c381, fdb70988 joined to the booking (found through resend_of). No live link kept for TikTok: none on record belongs to that network.
- **e2d47057** (Justin Engelke, "3") → draft: Its time (2026-09-28T08:00:00.000Z) has passed, so the time is cleared.
- **7bc2f99b** (Justin Engelke, "24") → draft: Its time (2026-09-28T02:00:00.000Z) has passed, so the time is cleared.
- **2a74c976** (Jordan Wilson, "4") → with_client: Frozen at migration, not at send — resend it so the client is sure to see this version.
- **e7f0e7a3** (Jordan Wilson, "3") → with_client: Frozen at migration, not at send — resend it so the client is sure to see this version.
- **e410ee80** (Justin Engelke, "Justin 3") → quality_check: Frozen at migration, not at send.
- **bb002da7** (MD Media, "FAV MD MEDIA ADS THIS WEEK") → draft: It has no channels chosen yet.

## Every post

Old = what the row and its card say today. New = what `--write` gives it. "v1" means a frozen version 1 is written, marked as made by the migration.

| Post | Client / card | Old status | Old card fields | Jobs | Rule | New stage | New fields |
|---|---|---|---|---|---|---|---|
| 717ace92 | 100 Hundred Million Group / 1b2f5116 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 3fb13277 | 100 Hundred Million Group / 9bb53bd4 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 1a78c21a | 100 Hundred Million Group / ec896a69 | scheduled; mode self; approved_by 01450dc3 | card deleted | 36edc904 cancelled [instagram] | M6 | **cancelled** | cancelled: card deleted; source_deleted |
| 008f0eeb | 100 Hundred Million Group / 2333a9ac | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| e732637a | 100 Hundred Million Group / 45c33927 | scheduled; mode self; approved_by b8c097aa | card deleted | d6138060 published [instagram] | M2 | **posted** | v1; sent_version 1; approval account_manager b8c097aa; booking d6138060; outcomes instagram published; source_deleted |
| 0d892f0f | 100 Hundred Million Group / 79b5e35c | scheduled; mode self; approved_by 01450dc3 | card deleted | dd4f5b9b cancelled [instagram] | M6 | **cancelled** | cancelled: card deleted; source_deleted |
| c5864fe7 | 100 Hundred Million Group / 48103f05 | scheduled; mode self; approved_by 01450dc3 | card deleted | ded78dc2 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking ded78dc2; outcomes instagram published; source_deleted |
| c6ad5cfd | 100 Hundred Million Group / 03aefe98 | scheduled; mode self; approved_by 01450dc3 | card deleted | f8eef3b4 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking f8eef3b4; outcomes instagram published; source_deleted |
| 29073745 | 100 Hundred Million Group / 461cf273 | scheduled; mode self; approved_by 01450dc3 | card deleted | 492a96b6 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking 492a96b6; outcomes instagram published; source_deleted |
| 14ce1db9 | 100 Hundred Million Group / 71327eb5 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 1f983c96 | Bond Street / 6c693339 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| a709ecb6 | 100 Hundred Million Group / f94aa1c4 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| d5830a61 | 100 Hundred Million Group / 2c068e45 | scheduled; mode assets; approved_by c3e52e7e | card deleted | c69941ad published [instagram] | M2 | **posted** | v1; sent_version 1; booking c69941ad; outcomes instagram published; source_deleted |
| 0fe9a87f | 100 Hundred Million Group / 6006598d | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| d95d3614 | 100 Hundred Million Group / 93b768b6 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 6120e788 | 100 Hundred Million Group / 1fe28dda | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| cf461fe2 | 100 Hundred Million Group / 1fe28dda | scheduled; mode self; approved_by 01450dc3 | card deleted | 15b32ef4 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking 15b32ef4; outcomes instagram published; source_deleted |
| cd69521d | 100 Hundred Million Group / e606fedb | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 9aceeadf | 100 Hundred Million Group / ace69fec | scheduled; mode self; approved_by 01450dc3 | card deleted | 41b02add published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking 41b02add; outcomes instagram published; source_deleted |
| 06b37a25 | 100 Hundred Million Group / 75ac531b | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 4e742215 | 100 Hundred Million Group / d4907f7f | scheduled; mode self; approved_by 01450dc3 | card deleted | 8e93a785 failed [tiktok,instagram] | M5 | **cancelled** | cancelled: card deleted; source_deleted |
| b2ce98f8 | 100 Hundred Million Group / 1422c0a8 | scheduled; mode self; approved_by 01450dc3 | card deleted | e851d9b8 published [tiktok,instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking e851d9b8; outcomes tiktok published, instagram published; source_deleted |
| 87d95b5a | ZZ TEST - Workflow (do not touch) / b96e6d90 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 1d064b93 | 100 Hundred Million Group / 9ae3dc8f | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 6a6ab64c | Alia Fragrance / 6234df5f | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 01444e51 | 100 Hundred Million Group / 616ea0e5 | published; mode self; approved_by 01450dc3 | card deleted | eea21e74 published [tiktok,instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking eea21e74; outcomes tiktok published, instagram published; source_deleted |
| 9dfc706e | 100 Hundred Million Group / 28e1cd0f | scheduled; mode self; approved_by 01450dc3 | card deleted | b73496b1 published [tiktok,instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking b73496b1; outcomes tiktok published, instagram published; source_deleted |
| 34adf560 | 100 Hundred Million Group / 744146b1 Event Spaces 1 | scheduled; mode self; approved_by 01450dc3 | status published; approval_state approved; client_required false | 9bdf3ad3 published [tiktok,instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking 9bdf3ad3; outcomes tiktok published, instagram published |
| df297b0f | 100 Hundred Million Group / a05e5c57 | cancelled; mode self; approved_by 01450dc3 | card deleted | 77c55128 failed [instagram] | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 25405bfc | ZZ TEST - Workflow (do not touch) / 0bd2ee42 Event Spaces 1 | scheduled; mode self; approved_by 01450dc3 | status published; approval_state approved; client_required false | e677ec5b published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking e677ec5b; outcomes instagram published |
| bea87749 | MD Media / 7573c3ed | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 682dfc5e | ZZ TEST - Workflow (do not touch) / 69ceae4a | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 62e18b32 | 100 Hundred Million Group / 6ed93ad8 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| fc11e086 | Capila Finance / 1f4649d0 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 84f9420e | 100 Hundred Million Group / f7690995 images | scheduled; mode self; approved_by 330fdbdb | status published; approval_state approved; client_required false | 015597d5 published [tiktok,instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 330fdbdb; booking 015597d5; outcomes tiktok published, instagram published |
| d7a1acb7 | 100 Hundred Million Group / d442fa45 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 9813efd1 | 100 Hundred Million Group / fa7916a4 images | scheduled; mode self; approved_by 330fdbdb | status published; approval_state approved; client_required false | bd4b1ce7 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin 330fdbdb; booking bd4b1ce7; outcomes instagram published |
| 1c6d107e | MD Media / 789e612c MD BTS- THE TEAM, THE TALENT, THE PROCESS, AND THE RESULT | scheduled; mode assets; approved_by b9be2fe1 | status published; approval_state approved; client_required false | 3d2e8537 published [instagram] | M2 | **posted** | v1; sent_version 1; approval super_admin b9be2fe1; booking 3d2e8537; outcomes instagram published |
| b7f6a5ef | MD Media / 06a5c4c3 FAV MD MEDIA ADS THIS WEEK | draft | status approved_for_scheduling | — | M11 | **draft** |  |
| ec6c7959 | ZZ E2E Test Client / a3748060 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| d22bb44f | ZZ E2E Test Client / 0fe91250 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| 96277ebd | Bond Street / 02744ae7 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 78257877 | Releeph / 1ec864eb | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 09be0c91 | Alia Fragrance / fa3af13e alia is worn in layers | draft | status approved_for_scheduling | — | M11 | **draft** |  |
| cf5eefcb | Alia Fragrance / c02791b9 more than one bottle. more than one step. | draft | status approved_for_scheduling | — | M11 | **draft** |  |
| a067daa0 | Alia Fragrance / b23a9aaf powder for the final touch | draft | status approved_for_scheduling | — | M11 | **draft** |  |
| 4004c0ab | 100 Hundred Million Group / df17a139 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| bcf0d69f | 100 Hundred Million Group / 0f0c6242 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 98230e41 | Justin Engelke / 4cb963e1 | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 4509e60c | Justin Engelke / 32d105ef | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| 04865ef4 | Justin Engelke / 0b16dd0f | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| e0662719 | 100 Hundred Million Group / 1f8ca8f3 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| b521c21f | Justin Engelke / d1d199be | cancelled | card deleted | — | M1 | **cancelled** | cancelled: card deleted; source_deleted |
| fd2cd7e5 | 100 Hundred Million Group / d05b9d89 | draft | card deleted | — | M11 | **cancelled** | cancelled: card deleted; source_deleted |
| fc3ee75b | 100 Hundred Million Group / 1a6d55e1 | scheduled; mode self; approved_by 330fdbdb | card deleted | 082a60f5 failed [instagram] | M5 | **cancelled** | cancelled: card deleted; source_deleted |
| ff85fac3 | Jordan Wilson / bc8ab921 Jordan 1 | published; mode client; approved_by b9be2fe1 | status published; approval_state approved; client_required true | 54f9c381 cancelled [linkedin] re-send of a8854fc7<br>a8854fc7 published [linkedin,instagram,tiktok]<br>fdb70988 duplicate [tiktok] re-send of a8854fc7 | M2 | **posted** | v1; sent_version 1; approval super_admin b9be2fe1; booking 54f9c381,a8854fc7,fdb70988; outcomes linkedin published, instagram published, tiktok published |
| 3192d68f | Justin Engelke / 84793a75 Justin | scheduled; mode self; approved_by b9be2fe1 | status published; approval_state approved; client_required false | 1cbe45ea published [tiktok,instagram,linkedin] | M2 | **posted** | v1; sent_version 1; approval super_admin b9be2fe1; booking 1cbe45ea; outcomes tiktok published, instagram published, linkedin published |
| 5adfb997 | Justin Engelke / d045e8ce 4 | cancelled | status approved_for_scheduling | — | M1 | **cancelled** | cancelled: no reason stored |
| e2d47057 | Justin Engelke / f0d2ff1f 3 | changes; mode client | status approved_for_scheduling; approval_state changes; client_required true; client_sent post 2026-09-28T02:40 | — | M9 | **draft** | v1; sent_version 1; steps team_then_client; change asked by client 20e16098; last_client_send 2026-09-28T02:40; time cleared |
| 11b9a6cc | Jordan Wilson / f5a79c72 16 | cancelled | status approved_for_scheduling | — | M1 | **cancelled** | cancelled: no reason stored |
| 7bc2f99b | Justin Engelke / 663216ad 24 | draft | status approved_for_scheduling | — | M11 | **draft** | time cleared |
| 9024fe1c | Jordan Wilson / 054e0959 11 | cancelled; mode client; approved_by b9be2fe1 | status published; approval_state approved; client_required false; client_sent post 2026-09-28T02:40 | d74690f7 cancelled [linkedin,instagram] | M1 | **cancelled** | cancelled: no reason stored |
| 2a74c976 | Jordan Wilson / 0fc6b6a0 4 | pending; mode client | status approved_for_scheduling; approval_state pending; client_required true; client_sent post 2026-09-28T02:40 | — | M7 | **with_client** | v1; sent_version 1; steps team_then_client; client_send 2026-09-28T02:40, approve by 2026-10-05T04:30, to 1 |
| e7f0e7a3 | Jordan Wilson / 7f199b2a 3 | pending; mode client | status approved_for_scheduling; approval_state pending; client_required true; client_sent post 2026-09-28T02:40 | — | M7 | **with_client** | v1; sent_version 1; steps team_then_client; client_send 2026-09-28T02:40, approve by 2026-10-11T23:30, to 1 |
| e410ee80 | Justin Engelke / da697908 Justin 3 | pending; mode client | status approved_for_scheduling; approval_state pending; client_required false | — | M8 | **quality_check** | v1; sent_version 1; steps team |
| bb002da7 | MD Media / bd34d60b FAV MD MEDIA ADS THIS WEEK | draft | status approved_for_scheduling | — | M11 | **draft** |  |
| bbf70b79 | Justin Engelke / f1bdd5d0 1 | scheduled; mode self; approved_by b9be2fe1 | status published; approval_state approved; client_required false | 7f7567e3 published [instagram,linkedin] | M2 | **posted** | v1; sent_version 1; approval super_admin b9be2fe1; booking 7f7567e3; outcomes instagram published, linkedin published |
| a7a5f0de | Jordan Wilson / 054e0959 11 | scheduled; mode self; approved_by 01450dc3 | status published; approval_state approved; client_required false; client_sent post 2026-09-28T02:40 | e50887a2 published [linkedin] | M2 | **posted** | v1; sent_version 1; approval super_admin 01450dc3; booking e50887a2; outcomes linkedin published |

## Schedule rows (one per network)

| Row | Card | Network | Before | After |
|---|---|---|---|---|
| 664bc5e9 | 84793a75 | linkedin | published, www.tiktok.com, 2026-09-25T09:45 | published, www.linkedin.com, 2026-09-25T09:45 |
| db43d45c | 84793a75 | instagram | published, www.tiktok.com, 2026-09-25T09:45 | published, www.instagram.com, 2026-09-25T09:45 |
| 2f178d68 | f7690995 | instagram | published, www.tiktok.com, 2026-09-14T07:45 | published, no link, 2026-09-14T07:45 |
| 48f70493 | 789e612c | instagram | published, www.instagram.com, 2026-09-22T08:34 | published, www.instagram.com, 2026-09-22T09:45 |
| 93ebe5c9 | 744146b1 | tiktok | published, www.instagram.com, 2026-09-09T15:15 | published, no link, 2026-09-09T15:15 |
| 8f3a9862 | bc8ab921 | linkedin | published, www.instagram.com, 2026-09-24T08:58 | published, www.linkedin.com, 2026-09-24T08:58 |
| d6cd38f7 | bc8ab921 | tiktok | published, www.instagram.com, 2026-09-24T08:58 | published, no link, 2026-09-24T08:58 |
| ade9808c | f1bdd5d0 | linkedin | published, www.instagram.com, 2026-09-28T09:45 | published, www.linkedin.com, 2026-09-28T09:45 |
| c8fd52cf | 054e0959 | instagram | published, www.linkedin.com, no time | no status, no link, no time |
- Card 054e0959: Instagram never went out for this card — it is still owed.
- Rows whose card was deleted are left as they are: 14 (034bda63, 0b2d3af7, 214fa176, 285f5dae, 36f7f8cb, 53a8b364, 614fd459, 9f470f30, b70f85a9, c6d30ab8, d84e55f5, dc0e4210, e0f7bd43, f251779a).

## Edit cards (the client-round stamp)

- 370209f1 "Video - 10": At With client since 2026-09-19T14:17 with no round stamp — given round 1.
- 4de414d6 "Shan Minor Edits": At With client since 2026-09-15T09:35 with no round stamp — given round 1.
- 9169e122 "First Shoot": client_round 2 with no client_rounds — normalised to [2].
- b98b07a3 "Video - 11": At With client since 2026-09-21T13:09 with no round stamp — given round 1.
- c836cf10 "Video - 18": At With client since 2026-09-21T06:15 with no round stamp — given round 1.
- ee923633 "Carousel": At With client since 2026-09-21T13:23 with no round stamp — given round 1.

## Publishing jobs no post holds

Re-sends found through `resend_of` are joined to their post above. These are the rest; the migration leaves them as they are.

- 14a42792 failed [instagram,linkedin,tiktok,youtube]: no card.
- 16d29a9f cancelled [instagram,linkedin,tiktok,youtube]: no card.
- 299a4f4f failed [instagram,linkedin,tiktok,youtube]: no card.
- 3972e886 failed [instagram,tiktok]: no card.
- 3d409e65 cancelled [instagram]: card 789e612c.
- 41ee4e5d cancelled [instagram]: card 789e612c.
- 4a8e1b78 published [instagram,tiktok]: no card.
- 50888a24 cancelled [tiktok,instagram]: card 616ea0e5 (deleted).
- 876ef471 published [instagram,linkedin,tiktok,youtube]: no card.
- 89d5133a cancelled [instagram]: card 789e612c.
- a0f4ee52 failed [instagram,linkedin,tiktok,youtube]: no card.
- e63c744f failed [instagram,linkedin,tiktok,youtube]: no card.
- e75d3d31 cancelled [instagram]: card 789e612c.
- f8a43131 cancelled [instagram,linkedin,tiktok,youtube]: no card.
