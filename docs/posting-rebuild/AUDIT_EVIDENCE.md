# Audit findings with evidence (82 confirmed, 29 Sep 2026)

## [high] The board places cards by the post's approval, but every action uses the edit's status, so the lane and what the card does disagree (board)

- Evidence: board-view-core.ts:759-771 (postingColumn) is called only from groupByLane at board-view-core.ts:789 (grep finds no other caller). dropOnLane/dropAction (807-816, 455-473), canMoveTo (board-core.ts:198-218), moveTargets (477-486), cardActions (356-423) and the useCardActs toast (useCardActs.tsx:50-51) all use card.status. Live: content_items 0fc6b6a0 and 7f199b2a (Jordan Wilson '4' and '3': approved_for_scheduling, posting_approval_state pending, posting_client_required true) are drawn in With client. da697908 (Justin Engelke 'Justin 3': pending, client not required) is drawn in Quality check. f0d2ff1f (Justin '3': state 'changes') is drawn in Draft. For the engine, all four are in Ready to post.
- Effect: Dragging one of these cards onto Ready to post is refused with the toast "Already in Ready to post" while it visibly sits in another column. Dragging it onto the Draft lane, or choosing "Move to Draft — Send back for changes", opens the send-back dialog and sends the EDIT back to revision_required, when on this board Draft means the post is not approved yet. The Move menu offers columns based on a position the person cannot see.
- Verified: Confirmed. grep finds postingColumn called only at board-view-core.ts:789 inside groupByLane. canMoveTo (board-core.ts:198-203) returns 'Already in <label>' whenever COLUMN_OF_STATUS[card.status] === column, dropAction and dropOnLane pass card.status, and moveTargets (board-view-core.ts:477-486) iterates dropAction. workflow-core.ts:160-166 gives approved_for_scheduling -> revision_required to account_manager/quality_reviewer, which actionFor turns into send_back. Live data read today: 0fc6b6a0 and 7f199b2a are approved_for_scheduling, pending, posting_client_required true, so postingColumn returns with_client. da697908 is pending with client not required, so quality_check. f0d2ff1f is 'changes', so draft. All four are adhoc_post true.

## [high] A card whose post is not approved can still be marked "Booked in" from the board, which skips post approval (board)

- Evidence: cardActions (board-view-core.ts:356-423) offers approved_for_scheduling→scheduled ("Booked in", actionFor line 344) to the scheduler hat and to super admins on any non-adhoc, non-deliver-only card, with no check on posting_approval_state. dropAction does the same for the Booked in lane. app/api/production/items/[id]/transition has no posting_approval_state or publishBlockReason check (grep finds neither). postingColumn only rewrites the ready_to_post column, so once a card's status is 'scheduled' it is drawn in Booked in whatever its post approval says. Live cards are not affected today: every approved_for_scheduling card in content_items has adhoc_post true, and adhoc cards have these moves filtered out.
- Effect: A handed-over or shoot card drawn in Draft or With client (post not approved, or waiting on the client) shows a filled "Booked in" button. Pressing it moves the card to Booked in with the client's approval still outstanding or refused.
- Verified: Confirmed in code, with nothing live. cardActions only filters scheduled/published for adhoc or deliver-only cards and never reads posting_approval_state. dropAction is the same. workflow.ts:879-883 enforces only a schedule_entries row, and skips even that for link cards (link_url set), so a handed shoot card with a link would move. Live: all 12 approved_for_scheduling rows are adhoc_post true and there are 0 'scheduled' rows, so no live card is affected today.

## [high] A handed-over card stays in Draft through its whole posting run (board)

- Evidence: board-view-core.ts:783-788 sends every card with handed && early (non-adhoc, scheduler_ids non-empty, cardColumn not ready_to_post/booked/posted/delivered) to 'draft'. handoff/route.ts:74-76 resets a handed card to draft_uploaded, and the scheduler then takes it on through quality_check and client_review, which are the edit statuses. waiting-core.ts:141-142/228 lists the same card as "Waiting on your quality check", and BoardCard.tsx:333 shows "Send to client" when it is at client_review. Live example: content_items c4a82d74 (Jordan Wilson 'First Shoot', scheduler_ids 1, draft_uploaded after a schedule_handoff on 25 Sep).
- Effect: Once the scheduler submits a handed card for quality check, or it goes to the client, it still sits in the Draft column. "Waiting on you" asks for a quality check on a card the board shows in Draft, and "Send to client" appears on a Draft card.
- Verified: Confirmed. board-view-core.ts:783-788: on the scheduler page, a non-adhoc card with scheduler_ids whose cardColumn is not in POST_APPROVAL_FROM goes to 'draft' (there is no 'done' lane on that page). That covers quality_check and client_review too. handoff/route.ts:74-76 sets draft_uploaded. BoardCard.tsx:333-338 shows Send to client whenever sendStage is non-null, and 'card' is the client_review case. Live: c4a82d74 is draft_uploaded with scheduler_ids [54ec9a10…] and client_rounds [2]. It is in draft_uploaded today, so the wrong-column case is shown by the code, not by this row right now.

## [high] "Sent to client" appears on posts that were never sent to the client (board)

- Evidence: board-view-core.ts:264-268: clientHadIt returns true when posting_client_required === true, even with no client_sent stamp. It also returns true on client_round/client_rounds, which belong to the EDIT's client review, not the post's. cardLines:198-200 prints `Sent to client <delivered_at>`, and delivered_at is the quality-check pass date. Live: content_items bc8ab921 (Jordan Wilson 'Jordan 1') has posting_client_required true and no client_sent. Its workflow_activity has posting_approval_sent then posting_approved by a super_admin on 24 Sep and no sent_to_client row, yet the card reads "Sent to client 24 Sep". waitingOnWords (post-to-client-core.ts:136) says "not emailed yet" for the same field combination.
- Effect: The Posted card claims the client had the post, but it was never emailed or linked to them and a super admin approved it. The date shown is the quality-check pass, not a send. A card whose edit went to the client also reads "Sent to client" for a post the client never saw.
- Verified: Confirmed. board-view-core.ts:265-268: clientHadIt is true when posting_client_required === true, and :198-200 prints 'Sent to client <delivered_at>'. Live: bc8ab921 'Jordan 1' is published with posting_client_required true, no client_sent field, and delivered_at 2026-09-24T08:10 (the moment of the quality-check 'Passed — approve without client'). Its workflow_activity has posting_approval_sent x2, then posting_approved at 08:58 by actor b9be2fe1, and no sent_to_client row, so the card reads 'Sent to client 24 Sep'. I did not look up the actor's role. post-to-client-core waitingOnWords returns 'not emailed yet' when sentForStage is null.

## [high] The drawer header says "Ready to post — Signed off. Needs a posting time." for posts that are not approved (board)

- Evidence: PostApprovalDetail.tsx:584-592 shows STATUS_LABELS[status] in a green chip (approved_for_scheduling is green) and whatHappensNext(status) from STATUS_MEANING ('Signed off. Needs a posting time.', workflow-core.ts:242). It never reads posting_approval_state. The scheduler page opens this drawer for every card (CardSheet `simple`, CardSheet.tsx:93-96). Live: 0fc6b6a0, 7f199b2a (waiting on the client), da697908 (waiting on the team) and f0d2ff1f (client asked for a change).
- Effect: Opening a card from the With client, Quality check or Draft column shows a green "Ready to post, signed off" header that contradicts the column the person just clicked in.
- Verified: Confirmed. PostApprovalDetail.tsx:584-592 draws a green chip for approved_for_scheduling and whatHappensNext(status), which returns STATUS_MEANING (workflow-core.ts:242 'Signed off. Needs a posting time.'). grep finds no posting_approval_state anywhere in PostApprovalDetail.tsx. CardSheet.tsx:94-96 routes adhoc or simple cards to this drawer, and the four live cards are all adhoc.

## [medium] "The client asked for a change" appears when a manager asked for the change (board)

- Evidence: board-view-core.ts:271,276: every posting_approval_state 'changes' returns POST_CHANGES_ASKED. posting-approval.ts:234-238,266: request_changes is allowed for any mayApprovePost hat, which includes account_manager and super_admin (posting-approval-core.ts:138-140), and the row does not record who asked.
- Effect: When an account manager reviews a scheduler's post internally and asks for a change, the card tells the scheduler the CLIENT asked for it.
- Verified: Confirmed. board-view-core.ts:275 returns POST_CHANGES_ASKED for any 'changes' state. posting-approval-core.ts:138-140 mayApprovePost includes account_manager and super_admin. posting-approval.ts:234-238 lets those hats request_changes, and the patch (:266-270) stores only the note, with no field saying who asked, so the card cannot tell a manager from the client.

## [medium] On a post waiting on the client, the card says so but its main button is "Approve the post" (board)

- Evidence: postWaitingLine (board-view-core.ts:279) returns 'A post is waiting on the client' when posting_client_required is true, but postApprovalOffer (303-313) ignores posting_client_required. cardActions (396-400) therefore makes "Approve the post" the filled primary and "Ask for a change" the next action for any AM or super admin. waiting-core.ts:186-188 deliberately withholds the offer in this case. Live: 0fc6b6a0 and 7f199b2a (emailed to jordan@ on 28 Sep).
- Effect: A manager sees "A post is waiting on the client" directly above a black "Approve the post" button. One press records the manager's own yes as the post approval (useCardActs.tsx:61-73; the route then books the post) before the client has answered.
- Verified: Confirmed. postApprovalOffer (board-view-core.ts:303-313) checks only pending plus mayApprovePost, not posting_client_required. cardActions makes waiting.primary the head. postWaitingLine returns POST_WAITING_CLIENT when posting_client_required is true, and BoardCard.tsx:292 renders it on the same card. waiting-core.ts:188 deliberately nulls the offer in this case. The posting-approval route (:41-44) calls bookApprovedPosts after an approve. Live: 0fc6b6a0 and 7f199b2a are pending with client_sent to jordan@ on 28 Sep.

## [medium] A post the client asked to change never appears in "Waiting on you" (board)

- Evidence: waiting-core.ts:185 only handles parseApprovalState === 'pending'. A card at 'changes' in approved_for_scheduling falls through: it is not client_review, not in CHECK_STATUSES, and asked_ids was cleared by the answer (posting-approval.ts:285). waitingRow returns null. Live: f0d2ff1f (Justin Engelke '3'), posting_changes_requested by the client portal at 2026-09-28T08:58; the post was updated at 09:04 and not re-sent.
- Effect: The post the client sent back sits in Draft. The panel above the board, which is meant to hold everything someone is held up by, leaves it out, so nobody is prompted to fix it and resend.
- Verified: Confirmed. waiting-core.ts:185 handles only 'pending'. After that come client_review, CHECK_STATUSES and asked_ids, and none applies to approved_for_scheduling/'changes'. Live: f0d2ff1f has asked_ids undefined. Its activity shows posting_changes_requested at 2026-09-28T08:58, then version_added v2 at 09:04:12 and v3 at 09:04:41, and no re-send, so waitingRow returns null.

## [medium] The success toast names a column the card does not land in (board)

- Evidence: useCardActs.tsx:50-51 builds `${label} — now in ${columnOf(to)}` from the raw status. After a quality reviewer's "Passed — approve without client" on a non-adhoc card (quality_check→approved_for_scheduling), groupByLane puts it in Draft, because postingColumn sends a null posting state to 'draft' (board-view-core.ts:770).
- Effect: The toast says "now in Ready to post" and the card appears in Draft.
- Verified: Confirmed. useCardActs.tsx:50-51 builds the toast from columnOf(to). For a non-adhoc card passed to approved_for_scheduling with a null posting state, postingColumn (board-view-core.ts:770) returns 'draft' on the scheduler page, and handed/early does not apply once the column is ready_to_post. So the toast says Ready to post and the card is drawn in Draft. This is code only: no live non-adhoc approved card exists today.

## [medium] List view shows one column in "Column" and a different one in "Stage" (board)

- Evidence: Board.tsx:424 passes the lane label (after postingColumn) as `lane`. BoardList.tsx:523-524 shows it next to lines.stage = STATUS_LABELS[card.status] (board-view-core.ts:215). Live: 0fc6b6a0 gives Column "With client", Stage "Ready to post". f0d2ff1f gives Column "Draft", Stage "Ready to post".
- Effect: Each row gives two different answers to where the post is.
- Verified: Real, but the line numbers cited are wrong. Board.tsx:424 passes g.lane.label, and it is BoardList.tsx:26 and 60-61 (not 523-524) that render the lane and lines.stage = STATUS_LABELS[card.status] (board-view-core.ts:215). For 0fc6b6a0 that gives lane 'With client' and stage 'Ready to post'. For f0d2ff1f it gives 'Draft' and 'Ready to post'.

## [medium] A card moved to Draft by postingColumn shows no reason for being there (board)

- Evidence: BoardCard.tsx:190: showStage is statusesIn(columnOf(status)).length > 1, and the ready_to_post column holds one status, so no stage chip. postWaitingLine (board-view-core.ts:276-277) returns null for a posting state of null or 'draft'. postingColumn (770) sends such non-adhoc cards to 'draft'.
- Effect: A finished, approved edit whose post has not been sent for approval yet sits in Draft with no chip and no line explaining it. It looks like work that is still being made, and its only button may be "Booked in".
- Verified: Confirmed in code. BoardCard.tsx:171 and 190 take column = columnOf(card.status) = ready_to_post, which has one status (board-core statuses ['approved_for_scheduling']), so there is no stage chip. postWaitingLine returns null for a null or 'draft' state. approvalTimeLine (Board.tsx:194) returns null unless the state is approved or pending. postingColumn sends non-adhoc cards with a null state to draft. Code only: there are no live non-adhoc approved_for_scheduling rows.

## [medium] Overview counts and lenses that link into this board use the raw status, so the numbers don't match the board (board)

- Evidence: board-view-core.ts:933 (inColumn uses cardColumn), 989-990 (scheduler 'Ready to post' tile), 976 (general tile), 1034 (With clients counts only status client_review), and 878-880 (the 'account' lens matches status approved_for_scheduling). None call postingColumn. Live: 12 approved_for_scheduling cards, 4 of which (0fc6b6a0, 7f199b2a, da697908, f0d2ff1f) the board shows outside Ready to post.
- Effect: For a general user the Overview says 12 ready to post and the Ready to post column shows 8. 'With clients' leaves out the 2 posts waiting on Jordan. "Waiting on an account" includes posts that are not ready.
- Verified: Confirmed in code. overviewTiles' inColumn uses cardColumn. The scheduler 'ready' tile uses cardColumn. withClients counts status client_review only. matchesShow 'account' tests status approved_for_scheduling. None call postingColumn. Live: 12 approved_for_scheduling rows, 4 of which postingColumn draws outside Ready to post. I did not render the board to confirm the exact 12 vs 8 on screen, since page scoping (fresh, viewer) can change counts.

## [medium] Posts waiting on approval after they are booked stay in Booked in (board)

- Evidence: postingColumn returns early unless the column is ready_to_post (board-view-core.ts:760). But sendStage treats status 'scheduled' with pending as a post waiting on the client (post-to-client-core.ts:85), and stateAfterPostEdit moves 'approved' back to 'pending' when a booked post is edited (posting-approval-core.ts:121-123). No live 'scheduled' rows today, so this is code only.
- Effect: A booked post that is edited and needs approval again, or is waiting on the client, stays under "Booked in", a column whose header says the channel has it.
- Verified: Confirmed in code. postingColumn returns early when column !== 'ready_to_post' (board-view-core.ts:760). sendStage treats 'scheduled' plus pending as 'post' (post-to-client-core.ts:83). stateAfterPostEdit moves approved to pending. Live has 0 'scheduled' rows, so this is code only.

## [low] The "since" date on a waiting post resets whenever the card is touched (board)

- Evidence: waiting-core.ts:194,202 date a pending post by card.updated_at, which any version upload, comment-driven edit or schedule sync bumps. It is not the posting_approval_sent time.
- Effect: "Waiting on the client since today" can appear on a post that was sent days ago, and the sort puts the longest waits in the wrong order.
- Verified: Confirmed. waiting-core.ts waitingRow's pending branch uses sinceWords(card.updated_at) and stamp: card.updated_at, not the send time. Any other write to the card bumps updated_at.

## [low] Managers are offered Delete on cards the channel already holds (board)

- Evidence: mayDeleteCard (board-view-core.ts:735) allows account_manager/super_admin on any status except 'published', which includes 'scheduled'. Board.tsx:328-331 says the entry is "never on a card the channel holds".
- Effect: "Delete this card" appears on Booked in cards, contrary to the board's own rule.
- Verified: Confirmed. mayDeleteCard (board-view-core.ts:733-735) returns status !== 'published' for account_manager/super_admin, which allows 'scheduled'. The Board.tsx:329-331 comment says 'never on a card the channel holds or has published'. There are no 'scheduled' rows live.

## [low] The "Emailed to client" button stays after the post's time changes and it needs sending again (board)

- Evidence: BoardCard.tsx:337 labels the button from sentForStage only, which ignores client_sent.for_time. approvalTimeLine (post-to-client-core.ts:171-184) puts NEW_TIME_WORDS on the same card when for_time no longer matches.
- Effect: One card shows both "✓ Emailed to client · Send again" and "New time set — send it to the client for approval again".
- Verified: Confirmed. sentForStage (post-to-client-core.ts:105-109) matches only the stage, not for_time, and BoardCard.tsx:337 labels the button from it. approvalTimeLine returns NEW_TIME_WORDS when stamp.for_time no longer matches any live post, and that line is drawn on the same card as the booking line (Board.tsx:194, BoardCard.tsx:274-275).

## [high] "Delete draft" does not delete: it cancels the post, which then appears on the week and month grids as a greyed "Cancelled" tile (schedule-views)

- Evidence: views.tsx:79-83 draws the bin for live_status==='draft', and page.tsx:412-416 then calls DELETE /api/social/schedule/{id}. That route ([id]/route.ts:55) runs cancelPost, which only claims status:'cancelled' (social-schedule.ts cancelPost, `{ ...cur, status: 'cancelled' }`). showsOnGrid (social-schedule-core.ts:1218) hides only 'draft', so the cancelled row now draws on the grids. Live example: social_posts 11b9a6cc-ecbc-4b72-9667-b196c4372e7b has no channels and no caption, was cancelled 30 s after it was created (14:14:23 to 14:14:53), and sits at 2026-09-27T22:30Z. Also 5adfb997-5859-4067-9828-e77d5b7cba6e: cancelled, no jobs.
- Effect: The toast says "Draft deleted", but the post leaves the Drafts list and lands on the calendar as a Cancelled tile. No tile or row has a bin for cancelled posts, and dragging one is refused ("This post was cancelled, so it cannot be moved"), so it stays there for good.
- Verified: Confirmed. views.tsx:79 shows the bin only when live_status==='draft'. page.tsx:412-416 sends DELETE and then toasts 'Draft deleted'. The DELETE route ([id]/route.ts) calls cancelPost, and social-schedule.ts:1946-1949 only claims {status:'cancelled'}. showsOnGrid (social-schedule-core.ts:1218) drops only 'draft', and useSchedulePosts keeps cancelled rows, so they reach `planned`. NO_MOVE.cancelled refuses a drag. Live: social_posts 11b9a6cc is status cancelled, created 14:14:23 and updated 14:14:53, scheduled_for 2026-09-27T22:30Z, no channels or jobs, and its item exists, so it is drawn. 5adfb997 is cancelled with no jobs and its item exists.

## [high] A post's own status is ignored: with no job yet, every post on an item shows the ITEM's post-approval state (schedule-views)

- Evidence: In social-schedule-core.ts:518-535, mirrorStatus reads post.status only for 'cancelled'. With no jobs it returns parseApprovalState(item.posting_approval_state), and a missing value becomes 'draft'. Posts can be split: one item can carry several posts (posted-slides-core, and 'items with >1 post' in the live data, e.g. item 054e0959-801e-4efa-9bcd-3e6aa16c9ab4 with posts 9024fe1c and a7a5f0de, whose item has posting_approval_state 'approved').
- Effect: A new draft made from an item's leftover files shows as green "Approved" and appears on the grid straight away, though nobody approved it. The reverse also happens: a post whose own row says pending or changes reads as Draft once the item's field is empty, and it drops off the grid. The post's stage is taken from the item, which is the mix-up of post approval with item approval that the owner described.
- Verified: Confirmed. mirrorStatus (social-schedule-core.ts:514-532) reads post.status only for 'cancelled'. With no jobs it returns parseApprovalState(item.posting_approval_state), or 'draft' when that is empty. The file header (lines 15-19) says 'THE POST'S APPROVAL IS THE ITEM'S' on purpose, which is the post/item mix-up the owner objects to. Live: item 054e0959 has posting_approval_state 'approved' and posts 9024fe1c (cancelled) and a7a5f0de (scheduled). Both carry jobs today, so the no-job case is shown from code, not from a live row. It is the only multi-post item whose item still exists.

## [high] The Stories strip and Stories view are always empty: they filter on an item content_type 'story' that no item has (schedule-views)

- Evidence: page.tsx:438-439 filters on `String(p.item_type).toLowerCase() === 'story'`, and item_type is content_items.content_type (useSchedulePosts.ts:314). The live content_type values are only carousel, other, reel, video and static. A story is set per channel on the post instead. Example: social_posts 9813efd1-9bf7-4e3c-a475-e85f83acb4fd has per_channel {kind:'story'} and its item's content_type is 'static'.
- Effect: The strip above the week says "Stories · none this week" and the Stories view says "No stories planned this week" even when a story is booked.
- Verified: Confirmed. page.tsx:438-439 filters inWeek on item_type==='story', and item_type is item.content_type (useSchedulePosts.ts:314). The live content_type values are exactly carousel, other, reel, video and static. The only post with a story is social_posts 9813efd1: per_channel {kind:'story'}, status scheduled, its item exists with content_type 'static'. It is never counted as a story.

## [high] Changing "Whose accounts" does not re-filter the calendar (stale memo) (schedule-views)

- Evidence: page.tsx:394-396: `channelPosts = useMemo(() => livePosts.filter(p => matchesChannel(...) && (owner === 'all' || p.channels.some(id => ownerAccountIds.has(id)))), [livePosts, selected])`. owner and ownerAccountIds are not in the dependency list.
- Effect: After picking a person in the owner dropdown, the rail filters (ownerMedia is memoised correctly) but the week, month, list, preview and the Waiting/Drafts counts keep showing the previous owner's posts until some unrelated data change recomputes them.
- Verified: Confirmed. At page.tsx:394-396 the channelPosts useMemo reads `owner` and `ownerAccountIds` (from useState at :102 and useMemo at :105), but its dependency list is only [livePosts, selected]. Changing the owner alone does not recompute the list.

## [high] A 'duplicate' job (the provider says the post is already live) is not treated as gone out (schedule-views)

- Evidence: mirrorStatus (social-schedule-core.ts:522-526) checks only LIVE_JOB_STATUSES, 'failed', 'published' and all-'cancelled'. Elsewhere 'duplicate' counts as live: post-outcome-core.ts:220, posting-card-core.ts:107, post-analytics.ts:288, and cancelPost's 'already gone out' check in social-schedule.ts. Live example: publish_jobs fdb70988-031a-4d88-8eac-e11df93123a4 has status 'duplicate', and its platform_results say tiktok 'published'. No post references it today.
- Effect: A post whose only job is 'duplicate' shows the item's approval state (e.g. green "Approved" or Draft) and can be dragged. Meanwhile its list row's outcome line says "went out". The tile says it has not posted when it has.
- Verified: Confirmed in code. mirrorStatus checks LIVE_JOB_STATUSES (['queued','publishing','scheduled'], publish-core.ts:138), then 'failed', 'published' and all-cancelled. It never checks 'duplicate'. Elsewhere 'duplicate' counts as gone out: post-outcome-core.ts:220, posting-card-core.ts:107, post-analytics.ts:288/290, and cancelPost at social-schedule.ts:1934. Live: publish_jobs fdb70988 is 'duplicate' with tiktok 'published', but no social_posts row references it, so no tile shows this today.

## [medium] When a job fails or is cancelled, social_posts.status stays 'scheduled', so the rail keeps treating those files as used (schedule-views)

- Evidence: takenSlideUrls (posted-slides-core.ts:41-48) counts any row whose stored status is 'scheduled' or 'published', and useSchedulePosts.ts:345-348 uses it to take files out of the rail. Live rows still marked 'scheduled' with dead jobs: 4e742215-e46e-42aa-a870-2ad69335628a (job failed), fc3ee75b-dfae-4a09-9e17-0516d8fd6214 (job failed), 0d892f0f-e3f8-4fb5-be3d-a1928a79f4ee and 1a78c21a-f9ce-4c9c-9119-7218abfb806d (job cancelled). canReschedule says for failed: "start a new one at the time you want" (social-schedule-core.ts:788).
- Effect: After a post fails, the tile tells the person to start a new one, but the rail has taken those files out as "used". The failed post cannot be dragged or re-booked from the rail, so there is no way forward. (The four live rows above belong to deleted items today, so they show the stuck status but not the rail symptom on screen.)
- Verified: Confirmed. takenSlideUrls (posted-slides-core.ts:41-48) counts stored status 'scheduled'/'published', and useSchedulePosts uses it to strip rail slides. No writer sets a post row to failed: every posts().claim in social-schedule.ts sets approved, scheduled, cancelled or draft. NO_MOVE.failed says 'start a new one'. Live: 4e742215 and fc3ee75b are 'scheduled' with a failed job, and 0d892f0f and 1a78c21a are 'scheduled' with a cancelled job. All four have deleted items, as the finding says, so the rail symptom is shown from code only.

## [medium] A partly posted job shows as "Did not go out" on the tile and in the list row's status (schedule-views)

- Evidence: mirrorStatus ranks 'failed' above 'published' (social-schedule-core.ts:524-525), and STATUS_WORDS.failed is 'Did not go out' (tiles.tsx:453). outcomesForJob reads partials back through parseOutcomeSentence (post-outcome-core.ts:257-263). Live partials: publish_jobs e63c744f-94e0-4e4b-b578-a6ec6d634d94 ("Went out on instagram, tiktok, youtube. Did not go out on linkedin…") and 14a42792-7bbe-4a9c-a11f-d474781a61da ("Went out on tiktok, youtube…"), both status 'failed'.
- Effect: A post that is live on three of four networks shows a red-outline "Did not go out" tile. In the List the same row says "Did not go out" next to "✓ Instagram … went out", so the row contradicts itself.
- Verified: Confirmed in code. A job stored as 'failed' maps to live 'failed', and STATUS_WORDS.failed is 'Did not go out' (tiles.tsx:27). outcomesForJob (post-outcome-core.ts:257-263) marks the channels named in 'Went out on …' as published, so the list row contradicts its own status word. Live error texts: e63c744f 'Went out on instagram, tiktok, youtube. Did not go out on linkedin…' and 14a42792 'Went out on tiktok, youtube…', both status failed. Neither job is referenced by any social_posts row today, so this is not on screen now.

## [medium] Preview's "feed as it will look" includes cancelled, failed, non-Instagram and already-published posts, and posted ones appear twice (schedule-views)

- Evidence: page.tsx:839 passes all of channelPosts to PreviewGrid, and previewOrder (schedule-drag-core.ts:227-235) sorts without filtering. views.tsx:367-382 draws each one as a planned square above the account's real grid (views.tsx:384), which already contains what has gone out.
- Effect: The planned feed shows cancelled and failed posts as if they will appear. With no channel picked it also shows TikTok- or LinkedIn-only posts. A published post shows once as a planned tile and again as the real post below it.
- Verified: Confirmed. page.tsx:839 passes all of channelPosts to PreviewGrid. previewOrder (schedule-drag-core.ts:227-235) only sorts; it filters nothing by status or platform. views.tsx:367 draws every ordered post as a square, then appends the live feed (views.tsx:384). With no channel selected, matchesChannel keeps every platform.

## [medium] Posts whose item was deleted disappear from the calendar, including 13 marked 'scheduled' (mostly past, 11 of them published) and a failed one (schedule-views)

- Evidence: useSchedulePosts.ts:296 `.filter(row => itemById.has(row.item_id))`. Live: 46 of 68 social_posts rows point at an item_id missing from content_items (draft 15, cancelled 17, scheduled 13, published 1) across 9 clients, e.g. fc3ee75b-dfae-4a09-9e17-0516d8fd6214 (job failed, 24 Sep) and c5864fe7/c6ad5cfd/e732637a (published 8 Sep). The rail's "Remove this piece" (page.tsx:576-580) deletes the item.
- Effect: Posting history and failures vanish from Schedule once the piece is removed. A failure from 24 Sep is shown nowhere on the calendar.
- Verified: The defect is real but one count is wrong. useSchedulePosts.ts:296 filters out rows whose item_id is not in itemById. The rail's Remove (page.tsx:576-580) sends DELETE to /api/production/items/{id}. Live: 46 of 68 social_posts rows are orphaned (draft 15, cancelled 17, scheduled 13, published 1) across 9 clients, which matches. Of the 13 'scheduled' orphans, the jobs are 9 published, 2 failed (4e742215, fc3ee75b on 24 Sep) and 2 cancelled, not '11 published'. c5864fe7, c6ad5cfd and e732637a are status scheduled with published jobs on 8 Sep.

## [medium] The Edit media launcher saves to the item's FIRST post, which may be a cancelled or finished one, so the edit misses the open post (schedule-views)

- Evidence: EditMediaLauncher.tsx:60 `postId: posts.find(p => p.item_id === m.itemId)?.id`. Posts are sorted by scheduled_for (useSchedulePosts.ts:319) and include cancelled ones. claimPostSlides (social-schedule.ts:1163-1165) quietly refuses settled or scheduled posts. Live example: item 054e0959 has the cancelled post 9024fe1c at 11:00, before the published a7a5f0de at 11:45.
- Effect: After an image is edited from the week toolbar, the post that is still open keeps its old slides. The editor still reports it saved.
- Verified: Confirmed in code. EditMediaLauncher.tsx:60 uses posts.find(p=>p.item_id===m.itemId), with posts sorted by scheduled_for and including cancelled rows. claimPostSlides (social-schedule.ts:1163-1165) returns without a claim for SETTLED or 'scheduled' posts, and the caller does not report it. The live example is slightly off: 9024fe1c (cancelled, 11:00) comes before a7a5f0de, whose row status is 'scheduled', not published. So on that item neither post would accept the edit anyway.

## [medium] The rail's "Remove this piece" can only be reached on cards that can already be posted (schedule-views)

- Evidence: MediaRail.tsx:316 shows Remove only when `isOpen`. openIt is reached only through the button that is `disabled={!m.ok}` (MediaRail.tsx:221) or the folder button, which renders only `{m.ok && ...}` (MediaRail.tsx:262).
- Effect: A greyed card ("No media yet", "With the client now", deliver-only) cannot be removed from Schedule by a manager. It stays in the rail with no action.
- Verified: Confirmed. MediaRail.tsx:316 renders Remove only when isOpen, and isOpen means openFolder===m.itemId, which only openIt sets. openIt is reached from the face button, which has disabled={!m.ok} (line 221), and from the folder button, which renders only inside {m.ok && …} (line 262). A card with ok=false can never be opened, so it can never be removed from here.

## [low] The "Waiting on …" words and the missed-time warning are frozen when the data loads (schedule-views)

- Evidence: useSchedulePosts.ts:313 calls waitingOnWords(..., client?.name, tz, ...), which defaults to now=Date.now(). The memo's dependencies (:320) are [posts.rows, jobs.rows, itemById, liveAccounts, clientId]: no client, no tz, no clock. slotMissed (post-to-client-core.ts:151) depends on the current time.
- Effect: A pending post whose time passes while the page is open keeps saying "Waiting on Jordan · emailed …" instead of the "needs a new time" warning, until some unrelated row changes.
- Verified: Confirmed. useSchedulePosts.ts:313 calls waitingOnWords(item, client?.name, tz, …) inside the tiles memo, but that memo's dependencies are [posts.rows, jobs.rows, itemById, liveAccounts, clientId], with no client, no tz and no clock tick. So the text is not recomputed as time passes. I did not open waitingOnWords to confirm its Date.now() default.

## [low] A lost channel connection is shown only in the tile's hover title; the tile still looks like a normal scheduled post (schedule-views)

- Evidence: channelBlockReason goes into block_reason (social-schedule-core.ts:1210), but PostTile (WeekGrid.tsx:84-96) puts it only in `title`/sr-only. The tone stays tileTone(live), e.g. blue for scheduled. The List row (views.tsx:59-65) does not show block_reason at all.
- Effect: A booked post that will not go out because its account was revoked looks the same as a healthy one unless someone hovers with a mouse (never on a phone or in the List).
- Verified: Confirmed. block_reason is set at social-schedule-core.ts:1201, while tone is tileTone(live) at :1195 and ignores it. WeekGrid.tsx:93 puts it only in the title string, used as title= (:108) and sr-only (:158). The month cells use it only in title (views.tsx:294/298). The List row (views.tsx:50-68) does not render block_reason.

## [low] Tiles show only the first network's logo (schedule-views)

- Evidence: WeekGrid.tsx:145-149 renders only `post.platforms[0]`, and month cells show no logo at all (views.tsx:308-309).
- Effect: A post going to Instagram and TikTok reads as Instagram-only on the week grid.
- Verified: Confirmed, at a slightly different line. WeekGrid.tsx:153-155 renders PlatformIcon for post.platforms[0] only, and :561 does the same. The month cells (views.tsx:300-310) render no PlatformIcon. The List row shows up to 3 (views.tsx:75).

## [low] A job marked published whose per-channel record still says scheduled shows "Posted" and "scheduled" on the same row (schedule-views)

- Evidence: outcomesForJob returns the stored record unchanged unless the job is cancelled (post-outcome-core.ts:237-241). Live example: publish_jobs b73496b1-930a-42f2-a556-b3e81b153d88 has status 'published' and platform_results tiktok:'scheduled', instagram:'scheduled' (post 9dfc706e, whose item is deleted, so it is hidden today).
- Effect: A list row would read "Posted" next to "TikTok video · scheduled" and "Instagram reel · scheduled".
- Verified: Confirmed in code. outcomesForJob (post-outcome-core.ts:237-241) returns the stored platform_results unchanged unless the job is cancelled. Live: publish_jobs b73496b1 has status 'published' and platform_results tiktok:'scheduled', instagram:'scheduled'. The only post that references it is 9dfc706e, whose item is deleted, so it is hidden today, as the finding says.

## [high] Caption box loses focus after the first keystroke (post-window)

- Evidence: NewPostDialog.tsx:326-352. The Escape/Tab-trap effect calls `el?.focus()` (line 330) on the dialog card, and its dependencies are `[picking, state.dirty]` (line 352). The first character typed dispatches 'caption', and composerReducer (schedule-compose-core.ts:490-493) flips dirty from false to true. The effect runs again and moves focus from the textarea to the card div (tabIndex -1). The same happens on the first keystroke in any More options text field (the 'extra' action also sets dirty), and again after each save, when dirty goes back to false.
- Effect: On any post that is not already dirty, one letter goes in and the cursor leaves the caption. The user has to click back into the box to keep typing, which is the reported 'loses focus after one keystroke'.
- Verified: NewPostDialog.tsx:328-352: the effect calls el?.focus() on card.current, which is the div at line 1229 with tabIndex={-1}. Its dependency list is [picking, state.dirty]. In composerReducer (schedule-compose-core.ts:490-493), 'caption' sets dirty:true and 'loaded' sets dirty:false, so the effect runs again the moment dirty flips and pulls focus off the textarea.

## [high] A cancelled or failed post is a dead end: no button, and the controls left open do nothing (post-window)

- Evidence: schedule-compose-core.ts:1556-1559: for status 'failed' or 'cancelled', footerActions returns `{key:'none', label: APPROVAL_LINE[status]}` and an empty menu, so the footer shows only 'Cancelled' or 'Did not go out' (NewPostDialog.tsx:1904). Meanwhile `locked` covers only scheduled and published (NewPostDialog.tsx:~610), so the time picker (line 1354), the caption and 'Change media' (line 1461) stay enabled. Any save through them hits updatePost's SETTLED refusal (social-schedule.ts:765/784): 'This post is finished — start a new one instead of changing it'. The bin (line 1860) calls cancelPost, whose claim needs `cur.status !== 'cancelled'` (social-schedule.ts:1947); on an already-cancelled post nothing changes, it returns 200, and the window just closes. Live data: 20 cancelled posts, for example 11b9a6cc-ce24… (item f5a79c72, approved_for_scheduling, scheduled 2026-09-27T22:30Z) and 5adfb997-5859… (item d045e8ce, approved_for_scheduling).
- Effect: A cancelled post cannot be re-booked or retried from its own window. The user can change the time, words or media, but nothing saves them. 'Take it off' closes the window and the cancelled tile stays on the calendar. The only way forward, starting a fresh post from the rail, is never mentioned.
- Verified: footerActions (schedule-compose-core.ts ~1556) returns key 'none' with an empty menu for failed and cancelled. `locked` (NewPostDialog.tsx:611) covers only scheduled and published, so the TimePicker (1354) and Change media (1454) stay enabled. updatePost refuses SETTLED statuses, which include cancelled and failed (social-schedule.ts:765/784). The bin is shown whenever status !== 'published'. For an already-cancelled post, cancelPost's claim returns null without throwing, and remove() then calls onClose(). I found no re-book path anywhere. Live data: 20 cancelled social_posts, and 11b9a6cc (item f5a79c72) and 5adfb997 (item d045e8ce) are cancelled with their item at approved_for_scheduling, as the finding says.

## [high] No 'Post now' for a draft, pending or changes post, while the error text says to choose it (post-window)

- Evidence: footerActions offers {key:'now'} only for 'approved' and 'scheduled' (schedule-compose-core.ts:1545-1553). For a manager's draft, the primary reads 'Post now' only when isPostingNow is true, i.e. the time is within 2 minutes ahead (line 1602). TimePicker.tsx has no 'now' control, and its minute select allows only 0/15/30/45 (MINUTE_STEPS, schedule-compose-core.ts:1104), so that 2-minute window is almost never reachable. Any quarter-hour less than 15 minutes away is refused with TOO_SOON (social-schedule-core.ts:1537), which ends 'To send it straight away, choose Post now.'
- Effect: Someone who wants a draft out immediately cannot do it. The picker has no 'now', the nearest quarter-hour is refused as too soon, and the refusal points to a Post now button that does not exist for this post.
- Verified: footerActions offers {key:'now'} only when the post is approved (and mayPublish) or scheduled. For the 'direct' button to read Post now, isPostingNow needs a time 0-2 minutes ahead. TimePicker's minute Field offers only MINUTE_STEPS [0,15,30,45] (schedule-compose-core.ts:1104), and the picker has no 'now' control. TOO_SOON (social-schedule-core.ts:1537) ends with 'To send it straight away, choose Post now.'

## [high] The approval box says 'Approved — booked in for <time>' even when the booking failed (post-window)

- Evidence: NewPostDialog.tsx:1143-1148: decide('approve') writes 'Approved — booked in for …' whenever state.scheduledFor is set. The server route (app/api/production/items/[id]/posting-approval/route.ts:41-44) runs bookApprovedPosts in a `.catch(console.error)`, and bookApprovedPosts (social-schedule.ts:1476-1495) swallows each schedulePost error (a time already gone, copies not ready, no publisher). The response carries only `{ok, posting_approval_state}`, so the window never learns the outcome. Live: post e2d47057-b021… is status 'changes' with scheduled_for 2026-09-28T08:00Z, already past. Sent again (sendForApproval passes saving:true, so there is no time check) and approved, it would show 'booked in for Mon 28 Sep' while schedulePost refuses the time.
- Effect: The manager is told the post is booked. It actually sits at 'approved' with no job and never goes out, and nothing on screen says so.
- Verified: decide() (NewPostDialog.tsx ~1143) writes 'Approved — booked in for …' whenever state.scheduledFor is set. The posting-approval route wraps bookApprovedPosts in .catch(console.error) and returns only {ok, posting_approval_state}. bookApprovedPosts (social-schedule.ts ~1476-1495) catches each schedulePost error and also silently skips a post when no publisher is found. Live: e2d47057 is 'changes' with scheduled_for 2026-09-28T08:00Z, which has already passed.

## [medium] 'This post is waiting on you' is shown to the manager when the post is with the client (post-window)

- Evidence: NewPostDialog.tsx:1748: the box shows when `status === 'pending' && mayPostWithoutApproval(role, clientSignsOff)`. It never reads content_items.posting_client_required or client_sent. Live: posts 2a74c976-05ac… (item 0fc6b6a0) and e7f0e7a3-3a54… (item 7f199b2a) are both pending with posting_client_required = true.
- Effect: After a manager sends a post to the client, reopening it still says the post is waiting on the manager and offers Approve. That label hides who actually has it.
- Verified: NewPostDialog.tsx:1748 shows the box on `status === 'pending' && mayPostWithoutApproval(role, clientSignsOff)`. The dialog never reads posting_client_required or client_sent (grep finds nothing). Live: 2a74c976 (item 0fc6b6a0) and e7f0e7a3 (item 7f199b2a) are both pending, with posting_client_required=true and client_sent stage 'post' to a client address.

## [medium] The Post approval ('reviewOnly') path in the window is unreachable, and would be refused if it ran (post-window)

- Evidence: NewPostDialog.tsx:593 and :989-1015 hold a reviewOnly branch, and footerActions has one at schedule-compose-core.ts:1525. Nothing passes reviewOnly: the only caller of useComposeFlow is social/schedule/page.tsx:127, which leaves it out. The Post approval page opens SendForApprovalDialog or NewCardDialog instead (scheduler/NewPostButton.tsx:65-85), although scheduler/page.tsx:41 claims it uses 'the Schedule page's own flow (useComposeFlow)'. Even if reached, that branch POSTs `to: 'internal_review'`. For content that edge is tasksOnly (workflow-core.ts:78), so checkTransitionAs rejects it with '"Submit for review" is a move for tasks and shoot plans…', and the error filter /already|not allowed from|cannot move/ (line 1009) does not match that text.
- Effect: The window behaves the same whether it is thought of as opened from Schedule or from Post approval. The comments and code describe a Post approval mode that does not exist, and wiring it up as written would show a red refusal on every content post.
- Verified: The only useComposeFlow caller is social/schedule/page.tsx:127, and it passes no reviewOnly. scheduler/NewPostButton.tsx opens NewCardDialog or SendForApprovalDialog instead, which contradicts the comment at scheduler/page.tsx:41. The reviewOnly send POSTs to:'internal_review'. For content, draft_uploaded→internal_review is tasksOnly (workflow-core.ts:78), and tasksAndPlans is set only by brief-task-core and task-kind-core. The refusal text at workflow-core.ts:342, '"Submit for review" is a move for tasks and shoot plans…', does not match /already|not allowed from|cannot move/.

## [medium] The media picker shows old window errors as 'Not saved yet' before any save (post-window)

- Evidence: NewPostDialog.tsx:1955 passes `saveProblems={problems}`, the composer's whole refusal list. Opening the picker (`setPicking(true)`, line ~1455) does not clear `problems`. MediaPicker.tsx:573-579 shows any non-empty saveProblems under the heading 'Not saved yet:'.
- Effect: If an earlier press (Schedule, Send) failed, opening Change media immediately shows 'Not saved yet' with that unrelated refusal, before the user has saved anything.
- Verified: `problems` is a useState (NewPostDialog.tsx:212) and is passed as saveProblems={problems} (line 1955). The Change media onClick (1457) is just setPicking(true) and does not clear it. MediaPicker.tsx:573-579 renders any non-empty saveProblems under 'Not saved yet:' whenever !saving.

## [low] Errors are hidden while a confirm question is open (post-window)

- Evidence: NewPostDialog.tsx:1699: the problem and note block renders only `!confirm && (…)`. The confirm row sits in the footer (lines ~1833-1856). A failed 'Take it off' calls setProblems without clearing confirm (remove() sets confirm to null only at the start, so this case clears), but any refusal that lands while the 'close' question is up stays hidden until 'Keep editing' is pressed.
- Effect: A refusal can be invisible while the footer shows a question, so the press looks like it did nothing.
- Verified: NewPostDialog.tsx:1699 renders the problem/note block only when !confirm, and the comment there calls this deliberate. The close X and Escape call requestClose, which sets confirm='close' when dirty, and busy does not disable them. So a save refusal that lands while that question is up stays hidden. This is a narrow timing case. Low severity is right.

## [low] The time picker's minute box can disagree with the time on the post (post-window)

- Evidence: TimePicker.tsx:~207: the minute select offers only MINUTE_STEPS 0/15/30/45. splitClock (schedule-compose-core.ts:1149) returns the post's real minute. The window writes off-quarter times itself: safeAt is rounded to the minute (NewPostDialog.tsx:527-529) and pushed in by the quiet 'time' dispatch, and 'now' reschedules to Date.now()+60s (line ~1053). A select whose value is not among its options displays the first option, '00'. When no time is set, the default is today at 6 pm (TimePicker.tsx:~100) even after 6 pm, and past hours are not disabled.
- Effect: The pill can read '3:07 pm' while the minute box shows ':00'. Picking an hour on a new post after 6 pm gives a time that has already gone, and the button is then refused.
- Verified: The TimePicker Minute Field is a native <select> with options only from MINUTE_STEPS 0/15/30/45. splitClock returns the post's real minute. The window writes off-quarter times itself: safeAt is rounded to the minute and dispatched quietly (NewPostDialog.tsx:527-539), and 'now' reschedules to Date.now()+60s (~1057). A controlled select whose value is not among its options shows the first option. With no value, the default is today at 6 pm (TimePicker.tsx ~121-124) whatever the current time.

## [low] sendToClient in the window is dead code; the button uses the board's email dialog (post-window)

- Evidence: NewPostDialog.tsx:1107 defines sendToClient (POST /send, client_too: true), which nothing calls. The 'Send to client' button (line ~1795) opens SendToClientDialog, which emails and sets posting_client_required / client_sent (send-to-client/route.ts:90-156), a different write path from the one the window's own note describes.
- Effect: There are two ways to send to the client, and they write different fields. The one that runs is not the one the window's code and messages were written for, which adds to 'Sent to client' labels disagreeing between screens.
- Verified: grep finds sendToClient only at its definition (NewPostDialog.tsx:1107); nothing calls it. The dialog renders SendToClientDialog (line 1943), and its route (send-to-client/route.ts:90-156) writes posting_client_required and client_sent, whereas the dead function POSTs /api/social/schedule/<id>/send with client_too. Dead code, so low severity.

## [high] Approval is one gate per ITEM, so once a post is approved, a second post on the same card can never be sent or approved (server-state)

- Evidence: posting-approval-core.ts:78-80: 'send' from 'approved' is refused ('This post is already approved'). The gate is never reset after booking or publishing (live: published items 0bd2ee42, 744146b1, f1bdd5d0, 84793a75 all still show posting_approval_state=approved). A new post has no sent_at, so statusOf gives 'draft' (social-schedule.ts:355). sendForApproval (:1224) and the manager path of scheduleWithoutApproval (:1373) both call actOnPostingApproval 'send' and get a 409. schedulePost (:1566) refuses a draft with 'Send the post for approval first'.
- Effect: On a card posted in parts, or any card that has had one approved post, the next post is stuck as a draft. Send for approval says 'already approved', Schedule says 'send it for approval first', and an account manager has no way through. Only a scheduler whose card was approved on the board (the viaBoard path) gets past.
- Verified: posting-approval-core.ts:78-80 refuses 'send' from 'approved'. No code resets the gate after booking or publishing: every writer of posting_approval_state was grepped, and none runs on publish. Live data: items 0bd2ee42, 744146b1, f1bdd5d0 and 84793a75 are status=published with pas=approved. statusOf (social-schedule.ts:354-355) returns 'draft' for a post with no sent_at and no jobs. sendForApproval (:1224) and the manager path of scheduleWithoutApproval (:1373) both call 'send' and get a 409. schedulePost (:1566-1572) refuses a draft with 'Send the post for approval first'. Only the viaBoard direct write (:1389) gets around it.

## [high] Cancelling one post wipes the approval of every sibling post and can kill a sibling's live booking (server-state)

- Evidence: cancelPost (social-schedule.ts:1957-1960) runs actOnPostingApproval 'reset' on the ITEM whenever the cancelled post had sent_at, which sets the shared gate to 'draft'. Sibling posts then mirror to 'draft' (mirrorStatus :527). A booked sibling that is later reworded (:1752) or rescheduled (:1852) has its provider job cancelled first. queuePublishJob then refuses with publishBlockReason('draft') (publish.ts:152), and the post is left 'approved' with no jobs (:1765, :1865).
- Effect: Cancelling post A silently takes the approval away from post B. B shows as Draft, and moving or re-wording B's booking loses the booking entirely with 'Send the post for approval first'.
- Verified: cancelPost (:1957-1960) calls 'reset' on the item whenever post.sent_at is set, and nextApprovalState turns 'reset' into 'draft'. mirrorStatus (core :527) then maps a sent sibling with no live jobs to 'draft', and syncFromItem writes that. A booked sibling still mirrors to 'scheduled' through its live jobs. But rewordBooked (:1741) and reschedule's requeue (:1846) call cancelJob first. queuePublishJob then returns publishBlockReason('draft') = 'Send the post for approval first' (publish.ts:152), and the post is left 'approved' with publish_job_ids [] (:1765, :1865).

## [high] A cancelled (or failed) post can never be re-booked: there is no way back (server-state)

- Evidence: statusOf returns 'cancelled' forever (social-schedule.ts:354, social-schedule-core.ts:519). updatePost refuses when status is in SETTLED=['published','failed','cancelled'] (:786-792, 'start a new one'). canReschedule refuses both cancelled and failed (social-schedule-core.ts:786-790). sendForApproval and scheduleWithoutApproval refuse SETTLED (:1207, :1304). No route un-cancels a post. Live: items d045e8ce and f5a79c72 sit at approved_for_scheduling and their only post is cancelled (5adfb997, 11b9a6cc).
- Effect: A person who cancels a post, or whose post failed, has to rebuild the whole post (files, caption, channels, per-channel options) from scratch. The card sits in Ready to post showing a dead, cancelled post.
- Verified: SETTLED=['published','failed','cancelled'] (:765). updatePost refuses SETTLED (:786). canReschedule's NO_MOVE covers failed and cancelled (core :786-804). sendForApproval (:1207) and scheduleWithoutApproval refuse SETTLED. A grep for rebook, uncancel, clone and restore in lib, api and schedule UI found nothing. Live data: items d045e8ce and f5a79c72 are approved_for_scheduling, and their only posts (5adfb997, 11b9a6cc) are cancelled. A new post can still be started, because the insertPost lock frees on cancelled, so the effect is 'rebuild from scratch', as the finding says.

## [high] The approval write is check-then-write, so two answers at once both land (server-state)

- Evidence: posting-approval.ts:290-302: `live = get(item)`, then compare, then `update(item.id, patch)`. This is a separate read and write, not table().claim(), which breaks CLAUDE.md trap 11. The client's portal approve_post (portal/act/route.ts:239) and a manager's request_changes or approve go through this same function.
- Effect: A client pressing Approve on the portal while a manager presses Ask for a change can both succeed. The last write wins, both sets of emails go out, and bookApprovedPosts may already have booked the post the manager just rejected.
- Verified: posting-approval.ts:290-302 does `live = table.get(item.id)`, compares, then `table.update(item.id, patch)`. That is a separate read and write, not claim() or compareAndSet, which breaks CLAUDE.md trap 11. Both the portal's approve_post (portal/act route.ts:239) and the dashboard route call this function.

## [high] The portal can approve a post that was never put to the client (server-state)

- Evidence: portal/act/route.ts:225-242: approve_post and request_post_changes check only that the item belongs to the token's client. They never check posting_client_required === true (awaitsClientPostApproval, posting-approval-core.ts:167) and skip the portalActions gate (:195-200). actOnPostingApproval accepts the 'client' hat (posting-approval-core.ts:139). Live: item da697908 is pending with posting_client_required=false (an internal sign-off only).
- Effect: Anyone holding the client's portal link can approve or reject an internal-only post approval by posting its item id. The post is then booked in (bookApprovedPosts, :255) without the account manager ever deciding.
- Verified: portal/act/route.ts:195-200 gates only approve, request_changes and comment through portalActions. The approve_post and request_post_changes branch (:225-242) checks only that item.client_id matches the token's client (:57) before calling actOnPostingApproval. That function does not check posting_client_required, and mayApprovePost accepts the 'client' hat. Live data: item da697908 has pas=pending and posting_client_required=false.

## [high] Nothing is frozen at send: the client approves whatever the post holds at the moment they press Approve (server-state)

- Evidence: send-to-client/route.ts:100 and :156 store only {at,to,stage,for_time} in client_sent. No caption, slides or version snapshot is taken. updatePost edits a 'pending' post freely: stateAfterPostEdit only reverts 'approved' (posting-approval-core.ts:121-123). claimPostSlides with a new version (social-schedule.ts:1172) moves the post to draft, but leaves the item 'pending' and client_sent in place.
- Effect: The client portal shows files or words that changed after the email was sent, while the card still says 'Emailed … <date>'. The client's yes then applies to content they were never sent.
- Verified: send-to-client/route.ts:100 and :156 write client_sent = {at,to,stage,for_time[,via]} only, with no caption, slides or version snapshot. stateAfterPostEdit (core :121-123) reverts only 'approved', so a pending post's caption can be edited through updatePost without any reset. claimPostSlides (:1172) un-sends the post but leaves the item pending and client_sent untouched.

## [high] New media on a pending post un-sends the post but leaves the item pending, so the client's yes books nothing (server-state)

- Evidence: writeMediaVersion to claimPostSlides (social-schedule.ts:1172) sets the post to status 'draft' and sent_at null. The item gate stays 'pending' (the reset at :1131-1138 only fires from 'approved'). After the client approves, bookApprovedPosts to syncFromItem to statusOf returns 'draft', because sent_at is null (:355). bookApprovedPosts only books status==='approved' (:1478).
- Effect: The Post approval card says 'waiting on the client', the client approves, and the post stays a Draft on Schedule with nothing booked and nobody told.
- Verified: claimPostSlides (:1161-1174) sets status 'draft' and sent_at null on a new version. The item reset at :1131-1138 only fires when the state is 'approved'. After an approve, bookApprovedPosts (:1477-1478) runs syncFromItem, and statusOf returns 'draft' (no sent_at, no jobs, :355). The list filters status==='approved', so the post is never booked and nothing tells anyone.

## [high] Deleting a card leaves a provider-held booking live when the card is still in Ready to post (server-state)

- Evidence: items/[id]/route.ts:382 refuses a delete only when item.status is 'scheduled' or 'published'. Line 403 cancels only 'queued'/'publishing' jobs, and only in our own table, with no provider call. A card posted in parts stays approved_for_scheduling while its first post is booked (moveItem: allBooked, social-schedule.ts:1670-1673). The social_posts rows are not in the removal list (:407).
- Effect: Deleting a part-booked card removes it from every screen while the provider still publishes the booked post, and nothing in the app shows it any more. Live: 46 social_posts point at deleted items, including 'scheduled' posts with failed jobs (fc3ee75b, 4e742215) that no calendar will ever show (listPosts filters them out, :2043).
- Verified: items/[id]/route.ts:382 checks for jobs behind the card only when item.status is scheduled or published. :400-403 cancels only 'queued'/'publishing' jobs, locally, with no provider deletePost, so a 'scheduled' job the provider holds survives. A part-booked card stays approved_for_scheduling (moveItem: allBooked, social-schedule.ts:1670). social_posts is not in the removal list (:407), and listPosts drops posts whose item is gone (:2043). Live data: 46 social_posts point at missing items, including 13 stored 'scheduled', and fc3ee75b and 4e742215 are 'scheduled' over failed jobs. No live orphan job is currently at provider status 'scheduled': the orphans are failed, cancelled or published, so this is a code-path defect with no live instance of a lost booking.

## [medium] 'Sent to client' is shown for cards whose post was never sent, because client_sent is never cleared (server-state)

- Evidence: The only writers of client_sent are send-to-client/route.ts:100 and :156. cancelPost's reset clears posting_client_required but not client_sent. The comment at post-to-client-core.ts:91-93 says 'see sentStampFor', but no such function exists (grep). clientHadIt (board-view-core.ts:267) is true on any client_sent. Live: item 054e0959 has client_sent (jordan@tkbg.com.au, for post 9024fe1c, which was then cancelled). The post that actually went out (a7a5f0de) was approval_mode 'self' and was never sent, yet the card reads 'Sent to client'.
- Effect: Post approval and Posted cards say 'Sent to client' or 'Emailed … <date>' about a post the client never saw. A second round re-uses the first round's stamp (sentForStage only matches the stage), so 'emailed' shows before anyone has sent anything.
- Verified: The only client_sent writers are send-to-client :100 and :156, and nothing clears it (grep). The 'reset' patch clears posting_client_required but not client_sent. sentStampFor does not exist; it is only mentioned in the comment at post-to-client-core.ts:93. clientHadIt (board-view-core.ts:265-267) is true on any client_sent, and :199 shows 'Sent to client <delivered_at>'. Live data: item 054e0959 has client_sent {at 28 Sep 02:40, to jordan@tkbg.com.au, stage post} and delivered_at 27 Sep. Its post 9024fe1c (sent, mode client) was cancelled, and the post that went out, a7a5f0de, is approval_mode 'self'. sentForStage matches only the stage, so a later round would reuse the stamp. One nuance: the client did receive an email, but it was about the cancelled post.

## [medium] The stored social_posts.status is never advanced to published or failed, and several readers trust it (server-state)

- Evidence: Live: 17 posts are stored 'scheduled' while their job is 'published' (e.g. a7a5f0de, bbf70b79, 3192d68f), and 0d892f0f and 1a78c21a are 'scheduled' over a cancelled job. Readers of the raw stored status: send-to-client route :98 and :121 (picks the post whose caption and time go in the email), portal/act :232-234 (the 'time has passed' refusal), tellTeamApprovedLate :90, cancelPost :1967, addMediaVersion :978, and approvalTimeLine (post-to-client-core.ts:177-181).
- Effect: The client email can quote an already-published sibling's caption or time. The portal can refuse a client's approval with 'the time has passed' because of an old, already-published post. Card lines disagree with the calendar, which uses live_status.
- Verified: Mostly holds. 'Never' is too strong: syncFromItem (:1429-1453) does write the mirrored status when it runs, and two posts are stored 'published' (01444e51, ff85fac3). Live data: 17 posts are stored 'scheduled' over a published job, 8 of them on existing items (a7a5f0de, bbf70b79, 3192d68f and others), and 0d892f0f and 1a78c21a are 'scheduled' over cancelled jobs. portal/act :232-234 counts a stored-'scheduled' published post with a past time as live, so it can refuse with 'time has passed'. send-to-client :98 and :121 pick the newest non-cancelled post by updated_at, which can be an already-published one.

## [medium] Re-send jobs are not linked to their post, so the post's status and cancel ignore them (server-state)

- Evidence: resendTimedOut (publish.ts:244-249) inserts child jobs with resend_of but never adds them to social_posts.publish_job_ids. jobsOf reads only those ids (social-schedule.ts:328-331), and cancelPost/liveJobsOf therefore never see the children. Live: post ff85fac3 has publish_job_ids=[a8854fc7] only, while its children 54f9c381 (cancelled) and fdb70988 (duplicate) exist.
- Effect: While a re-send is queued the tile shows the parent's outcome (Failed or Published), and cancelling the post leaves the queued re-send free to go out.
- Verified: resendTimedOut (publish.ts:232-249) inserts child jobs with resend_of and never touches social_posts. jobsOf (:328-331) reads only publish_job_ids, and foldResends is used only by PostApprovalDetail and the activity page, not by statusOf, cancelPost or liveJobsOf. Live data: post ff85fac3 has publish_job_ids=[a8854fc7], and its children 54f9c381 (cancelled) and fdb70988 (duplicate) are not listed. Nuance: cancel is refused when any channel is live, so the 'cancel leaves the re-send free' path needs a job where every network timed out.

## [medium] Saving a draft emails the managers that it is being published or scheduled (server-state)

- Evidence: insertPost (social-schedule.ts:703) calls notifyPublishQueued with publishNow: !input.scheduledFor. For a draft with no time, workflow.ts:564-568 then writes 'Publishing: <title> … is being published now'. startPostOnItem (every upload on Schedule) goes through the same insertPost.
- Effect: Account managers get 'Publishing now' or 'Scheduled for …' emails for drafts that nobody has approved or booked.
- Verified: insertPost always inserts status 'draft' (:680) and then calls notifyPublishQueued with publishNow: !input.scheduledFor (:703). workflow.ts:563-568 writes 'Publishing: <title>' / 'is being published now', or 'Scheduled for <time>', to the account managers (resolveAudience). Both createPost and startPostOnItem go through insertPost.

## [medium] Post approval is tied to the edit approval, not independent of it (server-state)

- Evidence: actOnPostingApproval refuses 'send' unless item.status is approved_for_scheduling or scheduled (posting-approval.ts:231-233). scheduleWithoutApproval performs the EDIT transitions (quality_check, then approved_for_scheduling) as part of scheduling the post (social-schedule.ts:1350-1368). sendForApproval requires the media to be eligible (:1211).
- Effect: A post uploaded straight from Schedule (which is itself the post) cannot be sent for post approval until it has passed the editor/designer edit flow, and pressing Schedule quietly moves the edit's own approval state.
- Verified: posting-approval.ts:231-233 refuses 'send' unless item.status is approved_for_scheduling or scheduled. sendForApproval requires eligibility(item, versions) to pass (:1211-1212). scheduleWithoutApproval performs the edit's performTransition to quality_check and approved_for_scheduling (:1350-1368) as part of scheduling.

## [medium] The booking email goes out before the booking exists (server-state)

- Evidence: schedulePost calls notifyManagersBooked at social-schedule.ts:1623, before queuePublishJob at :1626. On a queue error the post is rolled back to approved (:1640-1644), but the email has already gone.
- Effect: Managers are told a post is booked when the provider refused it.
- Verified: schedulePost calls `void notifyManagersBooked(...)` at :1623, before `await queuePublishJob` at :1626. On an {error} return, the post is rolled back to 'approved' (:1638-1644), but the email is already under way (booked-notify.ts sends unconditionally).

## [medium] schedulePost can leave a post 'scheduled' with no job (server-state)

- Evidence: The post is claimed to 'scheduled' with publish_job_ids [] (social-schedule.ts:1597-1600) before queuePublishJob. Inside queuePublishJob, the list and takeClaimLock (publish.ts:175-192) sit outside its try, so a throw there escapes, and the rollback at :1640 only runs on an {error} return.
- Effect: After a network error the post shows as booked but nothing is at the provider. updatePost says 'already booked — cancel it first' and Schedule says 'already booked'; only Cancel gets it out.
- Verified: The claim to 'scheduled' with publish_job_ids [] happens at :1597-1600. In queuePublishJob, the publish_jobs list and takeClaimLock (publish.ts:175-192) sit outside the try that starts at :194. schedulePost does not wrap queuePublishJob in a try, so a thrown error skips the rollback at :1638, which handles only an {error} return.

## [medium] One published part marks every schedule row of the card published (server-state)

- Evidence: recordPublishOnItem (production-publish.ts:401-403) updates ALL schedule_entries of the item to publish_status 'published', before checking whether the piece is fully posted (:421-428).
- Effect: On a card posted in parts, the later parts' times show as posted on the board and portal. moveScheduleRows and cancelPost then skip those rows (social-schedule.ts:1909, :1971), so moving or cancelling the later parts no longer updates their times.
- Verified: production-publish.ts:400-402 lists every schedule_entries row by item_id and sets publish_status 'published' on all of them, before the fullyPosted check at :421-428. moveScheduleRows (:1909) and cancelPost (:1971) skip rows with publish_status 'published'.

## [medium] The board-path clearance overwrites the gate without a claim (server-state)

- Evidence: scheduleWithoutApproval viaBoard does a plain table('content_items').update(...{posting_approval_state:'approved', posting_client_required:false}) (social-schedule.ts:1389-1395), with no expected-state condition.
- Effect: A client's or manager's 'changes' or 'pending' answer that lands at the same moment is overwritten to approved, and the post is booked anyway.
- Verified: social-schedule.ts:1389-1395 is a plain table('content_items').update with posting_approval_state 'approved' and posting_client_required false, with no expected-state condition or claim.

## [low] sendForApproval changes the item before it knows it can claim the post (server-state)

- Evidence: actOnPostingApproval 'send' is written and emailed (social-schedule.ts:1224) before the post claim (:1237). If the claim loses, it throws 409 (:1249) with the item already 'pending'.
- Effect: The approvers are emailed and the card says Waiting on approval, while the post itself is still in its old state.
- Verified: actOnPostingApproval 'send' (item write, activity and emails) runs at :1224-1229, before the posts().claim at :1237. If the claim loses and the live post is not 'pending', it throws a 409 (:1246-1249) with the item already 'pending' and nothing rolled back.

## [low] approval_mode says 'client' for every sendForApproval, even when the client is not asked (server-state)

- Evidence: social-schedule.ts:1241 hard-codes approval_mode:'client'. Live: post e410ee80 has approval_mode 'client' while its item da697908 has posting_client_required=false.
- Effect: The audit record of how a post was cleared is wrong. No screen reads it today (grep).
- Verified: social-schedule.ts:1241 hard-codes approval_mode:'client'. Live data: post e410ee80 has approval_mode 'client', while its item da697908 has posting_client_required=false. The claim that no screen reads it was not independently re-grepped.

## [low] cancelPost moves the card with a raw write instead of the workflow (server-state)

- Evidence: social-schedule.ts:1969 does a plain update of content_items.status to 'approved_for_scheduling', not performTransition or a claim, and decides 'others' from stored post statuses (:1966-1967).
- Effect: There is no workflow activity or guard. A card with a published sibling stored as 'scheduled' does not move, and a concurrent move can be overwritten.
- Verified: social-schedule.ts:1969 is a plain table('content_items').update to status 'approved_for_scheduling', with no performTransition and no claim. 'others' (:1966-1967) is computed from stored post statuses, and live data shows published posts stored as 'scheduled', so the stored value is unreliable. A published sibling stored 'scheduled' still counts and blocks the move. The effect holds either way.

## [high] Nothing is frozen at send: the client sees files added after the card was sent to them (portal)

- Evidence: portal-thread.ts:261 `liveFilesAt(row, clientSeenRound(row))` reads the current final_files. It filters them only by round number (final-files-core.ts:245), and client_sent (send-to-client/route.ts:156) stores only {at,to,stage,for_time}, with no file ids, caption or slides. Live example 1: content_items 411da9a1 (Justin Engelke 'First Shoot'). It was sent to client_review on 2026-09-23T16:18 with client_rounds [1]. All four of its round-1 final_files were uploaded later, between 2026-09-24T14:20 and 14:55 (workflow_activity 'updated final_files' 13:04 and 14:12). Live example 2: 9169e122 (The Glass Den 'First Shoot'). It was sent at 2026-09-22T00:01 with client_round 2. Round-2 files were uploaded afterwards at 02:44 and 02:45.
- Effect: The client approves or comments on files they were never sent, and the version the email invited them to review cannot be reconstructed afterwards.
- Verified: portal-thread.ts:261 calls liveFilesAt(row, clientSeenRound(row)). final-files-core.ts:245 filters the current final_files by version <= round only. send-to-client/route.ts:156 writes client_sent {at,to,stage,for_time} and nothing else. Live data: 411da9a1 moved quality_check->client_review at 2026-09-23T16:18:29, and its four v1 final_files are dated 2026-09-24T14:20 and 14:55 (workflow_activity 'updated final_files' at 13:04 and 14:12 on the 24th). 9169e122 was sent at 2026-09-22T00:01 with client_round 2. Its v2 'Glass_Den 1.mov' is dated 02:44:29, and a new asset 'Glass_Den 6.mov' v2 is dated 02:45:05. Both are round 2, so both are shown.

## [high] Post approval page reads the social_post live, so what the client approves is not what was sent (portal)

- Evidence: portal-thread.ts:276-293 re-reads social_posts on every request and picks the newest non-cancelled post by updated_at: slides, caption, scheduled_for and channels. social-schedule.ts:864-885 only moves the approval when the state is 'approved' (stateAfterPostEdit, posting-approval-core.ts:121). So an edit while the post is pending, or after the client asked for changes, changes the page with no new send and no notice. PostReview.tsx:128 still says 'Caption, exactly as it will post', and PortalPostApproval.tsx:202 says 'Approving means it goes out exactly as you have just seen it'.
- Effect: The caption, pictures or time in the email can differ from the page the client presses Approve on. Their yes is recorded against whatever the post is at that moment.
- Verified: portal-thread.ts:274-293 re-reads social_posts on every request and uses the newest non-cancelled post by updated_at for slides, caption, time and channels. social-schedule.ts:864-885 only resets the approval when stateAfterPostEdit returns non-null, and posting-approval-core.ts:121 returns 'pending' only from 'approved'. Its own comment says a pending post 'shows the approver the latest content anyway'. So an edit made while the post is pending changes the page after the email went out. PostReview.tsx:128 'Caption, exactly as it will post' and PortalPostApproval.tsx:202 'Approving means it goes out exactly as you have just seen it' are confirmed. I checked the code only; I found no live example of an edit made after a send.

## [high] A client can approve a post that was only sent for internal (team) approval (portal)

- Evidence: api/portal/act/route.ts:225-248 calls actOnPostingApproval for approve_post with no check on posting_client_required. posting-approval.ts:235 only requires mayApprovePost(hats), and posting-approval-core.ts:139 counts 'client' as an approver. Live: content_items da697908 (Justin Engelke 'Justin 3') has posting_approval_state 'pending' and posting_client_required false. It was sent for approval by b9be2fe1 at 2026-09-28T05:49 and has not been sent to the client. Item ids are in the portal page's props (see the leak finding below).
- Effect: A post waiting on the account manager can be approved from the client's share link. The team board then moves it to Ready to post, skipping the internal approval.
- Verified: The approve_post branch in api/portal/act/route.ts:225-248 checks only a missed slot, then calls actOnPostingApproval. Nothing earlier in the route reads posting_client_required: portalActions only gates approve, request_changes and comment. posting-approval.ts:235 requires mayApprovePost(hats), and posting-approval-core.ts:139 includes 'client'. Live: da697908 is approved_for_scheduling with posting_approval_state 'pending' and posting_client_required false. Its only send is posting_approval_sent by b9be2fe1 at 2026-09-28T05:49. Post e410ee80 is pending for 2026-09-30T08:00, which is in the future, so the missed-slot check would not block it.

## [high] ?preview=1 is not gated, and it shows posts waiting on the team to the client (portal)

- Evidence: approve/[id]/page.tsx:26 takes `preview` from the query string with no team auth. portal-thread.ts:275 then opens the post branch for `opts.preview && postState === 'pending'` even when posting_client_required is false. Preview only disables the buttons in the browser (ApprovePanel.tsx:38); the act route accepts the POST. Live: da697908 would render as 'waiting', with its caption 'A client messaged me…' and its time 30 Sep 08:00.
- Effect: Anyone with the client's link can see an internal-only post, with its caption, time and networks, before the team has passed it to the client.
- Verified: approve/[id]/page.tsx:26 sets preview from searchParams.preview === '1', with no auth check. portal-thread.ts:275 opens the post branch on `opts.preview && postState === 'pending'`, whatever posting_client_required says. ApprovePanel.tsx:38 blocks only on the client side, and the act route has no preview check. Live: da697908 is pending with client_required false, and post e410ee80 has caption 'A client messaged me at 10 one night…' and scheduled_for 2026-09-30T08:00.

## [high] Every Published card opens a page saying 'Approved — thank you. We'll book it in to go out' (portal)

- Evidence: PortalBoard.tsx:313 links every work card that has media to /approve/<id> ('Open'). getPortalApproval's card branch (portal-thread.ts:310-311) maps status published to state 'approved'. ApprovePanel.tsx:68-70 then renders 'Approved — thank you / We'll book it in to go out. Nothing else to do.' Live examples, all published, adhoc and with the client never asked: f1bdd5d0 (Justin Engelke '1'), 789e612c (MD Media BTS), f7690995 and fa7916a4 (100 Hundred Million 'images'). bc8ab921 (Jordan 'Jordan 1') is published and was approved by team member b9be2fe1 at 2026-09-24T08:58, yet takes the post branch because posting_client_required is true, and shows the same 'Approved — thank you'.
- Effect: On a post that is already live, the client is told they approved it and that it will be booked in, which is untrue on both counts.
- Verified: PortalBoard.tsx:313 sets reviewHref for any work card with assets. Assets come from canComment (line 107), and portalActions gives comment=true for published (portal-core.ts:118, CLIENT_FACING_STATUSES). The card branch at portal-thread.ts:311 maps published to 'approved', and ApprovePanel.tsx:68-70 then renders 'Approved — thank you / We'll book it in to go out. Nothing else to do.' Live: f1bdd5d0, 789e612c, f7690995 and fa7916a4 are all published, adhoc, with client_required false and asset_versions that have files. bc8ab921 is published with state 'approved' and client_required true, so it takes the post branch and gets the same text; its posting_approved was by b9be2fe1 at 2026-09-24T08:58.

## [high] The approval link emailed to the client later shows their approval, though the team approved it (portal)

- Evidence: Live: content_items 054e0959 (Jordan Wilson '11'). client_sent is {at 2026-09-28T02:40, stage post, to jordan@tkbg.com.au}. At 10:57 01450dc3 ran posting_approval_reset, which sets posting_client_required=false (posting-approval.ts:276). At 11:22 01450dc3 ran posting_approval_sent and then posting_approved, and the post went out at 11:46. The client's emailed link now takes the card branch (required is false), which reports state 'approved' from the status (portal-thread.ts:311).
- Effect: Jordan opens the link he was emailed and reads 'Approved — thank you', but he never answered. The reset also left the client_sent stamp in place.
- Verified: Live 054e0959: client_sent is {at 2026-09-28T02:40:20, stage post, to [jordan@tkbg.com.au]}. At 10:57:53, 01450dc3 ran posting_approval_reset, which sets posting_client_required=false (posting-approval.ts:276) and does not clear client_sent. At 11:22:32 the same user ran posting_approval_sent and then posting_approved, and the status change at 11:46 made it published. It is now published with client_required false, so it takes the card branch, which returns 'approved' (portal-thread.ts:311) and shows 'Approved — thank you'.

## [high] An unsent upload's picture becomes the client's portal hero backdrop (portal)

- Evidence: portal-data.ts:473 sets clientFacing from the status alone, so an approved_for_scheduling item gets preview_url even when portalColumnForPost (portal-core.ts:77) puts it in 'checking' because the client never saw it. page.tsx:35-37 heroMedia(data.cards) takes the first card that has a preview_url, from all cards, not only the rendered sections. Live: Alia Fragrance's hero resolves to fa3af13e 'alia is worn in layers'. It is approved_for_scheduling, adhoc, has no posting state and no client_round, and was passed at QC by 4e4ea4eb on 2026-09-21T13:02 ('Passed — approve without client'). The same client's b23a9aaf and c02791b9 are in the same state.
- Effect: Work the client has never been sent is shown full-bleed at the top of their portal.
- Verified: portal-data.ts:473/486 sets preview_url whenever the status is client-facing. portal-core.ts:77 sends approved_for_scheduling with clientSaw false to 'checking', and portalSections (portal-core.ts:324-333) does not render 'checking'. page.tsx:35-37 heroMedia still scans all of data.cards. Live: Alia has only three items (fa3af13e, c02791b9, b23a9aaf), all approved_for_scheduling, adhoc, with no posting state and no client_round. fa3af13e is the newest (updated 2026-09-21T13:02:38), and its asset_version has files. workflow_activity shows 4e4ea4eb 'Passed — approve without client' at 13:02:38.

## [medium] Full board payload, including in-production and unsent cards, is shipped to the browser (portal)

- Evidence: page.tsx:161 passes the whole `data` object to the 'use client' PortalSectionsView. data.cards covers every non-internal item (portal-data.ts:702), and data.in_production is also sent (portal-data.ts:846). For approved_for_scheduling items the client has not seen, toPortal/workCards include slides, preview_url, drive_url, caption and link, because `facing` is status-based (portal-data.ts:721-731). Live examples: 663216ad, d045e8ce, f5a79c72, bd34d60b and 06a5c4c3.
- Effect: Titles of drafts, and media and links of posts never sent, can be read from the page source. They also supply the item ids that the preview and approve_post holes above need.
- Verified: page.tsx:161 passes the whole `data` object to PortalSectionsView, which is marked 'use client'. portal-data.ts:846 includes in_production, which has titles but no media, because toPortal blanks media for non-facing statuses. workCards (portal-data.ts:721-740) include slides, preview_url, the drive/link url and the caption for any approved_for_scheduling item, based on status alone. Live: 663216ad, d045e8ce, f5a79c72, bd34d60b and 06a5c4c3 are all approved_for_scheduling and adhoc, with no client_round, so they fall in 'checking' but still carry media in the payload.

## [medium] The client portal shows a post as 'waiting on you' before anyone has emailed it (portal)

- Evidence: posting-approval.ts:252 sets posting_client_required from `client_too` on any 'send' (for example the composer), and send-to-client/route.ts:108-114 claims posting_client_required=true before the emails are attempted. If every email fails, the route returns 502 and the flag stays set. portal-data.ts:575 (awaitsClientPostApproval) then lists the post under 'A post waiting on you', and it counts toward the hero's review number (portal-core.ts:373). Live: bc8ab921 has posting_client_required true and client_sent null, and was sent for approval twice at 2026-09-24T08:21.
- Effect: The client finds an approval request on their page that nobody sent. The team board's 'Sent to client' (board-view-core.ts:267 counts posting_client_required) agrees with it, so both sides say it was sent.
- Verified: send-to-client/route.ts:108-114 claims posting_client_required=true before any notify(). When no email is delivered, line 169 returns 502 and the flag is never rolled back. The composer is a second path: NewPostDialog.tsx:1114 sends client_too:true, which sets the flag (posting-approval.ts:252), and posting-approval.ts:331-356 emails only the managers, never the client. board-view-core.ts clientHadIt counts posting_client_required===true as 'had it'. Live: bc8ab921 has client_required true and client_sent null, and posting_approval_sent ran twice at 2026-09-24T08:21. It is published now, so it does not show as waiting today.

## [medium] Edit-stage notes are pinned to the post's slides by index (portal)

- Evidence: The post branch returns `comments: detail.comments` (portal-thread.ts:297), which is every client-visible item_comment on the item (portal-thread.ts:101-106). That includes notes left while reviewing the edit. PostReview.tsx:53-55 places each note by its slide-tag index on whatever slides the post has now.
- Effect: A note about clip 3 of the edit shows up on picture 3 of the final post, which mixes the edit approval with the post approval that the owner says are independent.
- Verified: portal-thread.ts:101-106 loads every client-visible item_comment on the item, with no stage filter. The post branch returns comments: detail.comments (line 297). PostReview.tsx:53-55 places each note on a slide by the index from splitSlideTag. I confirmed this in the code only; I did not locate a live item with edit-stage notes that also has a post.

## [medium] Home card frames and the approval page can show different posts (portal)

- Evidence: portal-data.ts:443-448 compositionByItem picks the newest post by scheduled_for and does not skip cancelled ones. portal-thread.ts:277 and send-to-client/route.ts:121 pick the newest non-cancelled post by updated_at. The home card's fallback caption is content_items.caption (portal-data.ts:576, PortalPostApproval.tsx:135), but the approval page uses social_posts.caption. Live: all adhoc items have content_items.caption '' while their posts carry captions (e.g. 7f199b2a: post caption '3 mistakes I see mum…', item caption empty).
- Effect: When an item has a cancelled post or a re-timed copy, the preview frames on the portal home can come from a different post (or a cancelled one) than the one the client approves. If the frames fail, the home card shows no caption.
- Verified: portal-data.ts:419-422 loads all social_posts for the items without filtering out cancelled ones. The compositionByItem loop at 442-448 picks the newest by scheduled_for, and line 597 builds the home frames from it. portal-thread.ts:277 and send-to-client picking the newest non-cancelled post by updated_at are confirmed. PortalPostApproval.tsx:135 falls back to item.caption. Live: 7f199b2a has no caption on the item, while post e7f0e7a3 has '3 mistakes I see mum and dad investors…'. I found no live item where the two picks differ today (054e0959's newest by scheduled_for is its non-cancelled post).

## [medium] Portal column disagrees with the team's posting board for approved posts (portal)

- Evidence: On the team side, board-view-core.ts:744-754 postingColumn sends a non-adhoc card with no approved post to Draft. On the portal side, portal-core.ts:73 and 77-79 put the same card in 'approved' ('Approved — we'll book a posting time.', green) whenever clientSaw is true, and also when posting_approval_state is 'approved' after the team approved it with posting_client_required false. cardLine then says 'Approved' in the client's voice. Adhoc cards with no state, by contrast, are Ready to post on the team board (board-view-core.ts:754) but 'checking' on the portal until they are scheduled, at which point they jump to Done with media (portal-core.ts:77 only covers approved_for_scheduling).
- Effect: The client sees 'Approved' for a post the team shows in Draft, or for one only the team approved. The same unsent upload is hidden while at Ready to post and appears as 'Going out…' the moment it is booked.
- Verified: The logic holds, but the line numbers have drifted: postingColumn is at board-view-core.ts:759-770, not 744-754. It sends a non-adhoc card with no state to 'draft', and an adhoc card with no state (not 'changes') to ready_to_post. portal-core.ts:66-80 portalColumnForPost returns 'approved' for approved_for_scheduling with no state when clientSaw is true, and 'checking' for an adhoc card with clientSaw false. Line 77 applies only to approved_for_scheduling, so once the status is 'scheduled' it falls through to base 'posted' (Done).

## [medium] 'Thanks — we have your note' and 'We're making your changes' show when the team asked for the change (portal)

- Evidence: portal-thread.ts:294 maps posting_approval_state 'changes' to state 'changes' whoever wrote it. ApprovePanel.tsx:68-70 renders 'Thanks — we have your note'. portal-core.ts:88 gives the card 'We're making your changes'. actOnPostingApproval records request_changes from an account manager to the same field (posting-approval.ts:266).
- Effect: A client who never commented is thanked for their note.
- Verified: portal-thread.ts:294 maps posting_approval_state 'changes' to 'changes' whoever set it. posting-approval.ts:266-270 writes 'changes' on request_changes by an account manager, and does not record whether the author was the client. ApprovePanel.tsx:68 renders 'Thanks — we have your note', and postingCardFace (portal-core.ts ~87) returns 'We're making your changes' for state 'changes'. This applies when posting_client_required is true, so the post branch is taken.

## [high] A post on several networks gets one network's link on every network's schedule row (live-data)

- Evidence: 9 of the 23 schedule_entries rows with a live_url carry a URL from a different network (read live, host compared with platform):
- 84793a75 'Justin': rows 664bc5e9 (linkedin) and db43d45c (instagram) both hold a tiktok.com URL.
- f1bdd5d0 '1': row ade9808c (linkedin) holds an instagram.com URL.
- bc8ab921 'Jordan 1': rows 8f3a9862 (linkedin) and d6cd38f7 (tiktok) hold an instagram.com URL.
- 744146b1: row 93ebe5c9 (tiktok) holds an instagram.com URL.
- f7690995: row 2f178d68 (instagram) holds a tiktok.com URL.
- 054e0959: row c8fd52cf (instagram) holds a linkedin.com URL.
Cause, in code: production-publish.ts:398-403 writes the job's single permalink to every row on the item. post-analytics.ts:213-214 fills every empty row with the analytics row's one URL. The platforms argument passed into recordPublishOnItem is never used to match rows.
- Effect: The client portal lists each network with its live link (portal-data.ts:465). A client or AM who clicks 'Instagram' or 'LinkedIn' lands on the TikTok or Instagram post instead. Every multi-network post in September is affected.
- Verified: Live schedule_entries: 8 of the 23 rows with a live_url have another network's host, not 9. They are 664bc5e9/db43d45c (tiktok URL on linkedin/instagram), ade9808c, 8f3a9862, d6cd38f7, 93ebe5c9, 2f178d68 and c8fd52cf, all as listed. Code confirms the cause. production-publish.ts:394-403 writes one permalink and publish_status to every row of the item and never uses the `platforms` argument. post-analytics.ts:212-214 back-fills every empty row with one URL.

## [high] A network that never posted is marked Published (live-data)

- Evidence: Item 054e0959 (Jordan Wilson, '11'): schedule_entries c8fd52cf reads platform=instagram, publish_status=published, live_url=linkedin.com/…7510303919114362880, and has no scheduled_at. The only published job, e50887a2, targeted LinkedIn only. Instagram was on job d74690f7, which was cancelled at 10:57 on 28 Sep. The live post a7a5f0de has one channel. Cause: production-publish.ts:393-403 sets publish_status 'published' on every schedule row of the item, whatever the network.
- Effect: The portal and any report built on schedule_entries say this carousel went out on Instagram. It never did. Nobody will notice that Instagram is still owed.
- Verified: Row c8fd52cf reads instagram, published, a linkedin.com URL, and scheduled_at is undefined. Job e50887a2 (published) targets only [linkedin]. Job d74690f7 [linkedin, instagram] is cancelled, updated 2026-09-28T10:57:53. production-publish.ts:394-403 marks every row published, whatever its network.

## [medium] social_posts.status stays 'scheduled' after the post is live (live-data)

- Evidence: No code path writes social_posts.status = 'published' after a job publishes (a grep found no such write in publish.ts, zernio-webhook.ts or production-publish.ts). Posts still reading 'scheduled' while their job is published and the item is published: 3192d68f (job 1cbe45ea), bbf70b79 (7f7567e3), 34adf560 (9bdf3ad3), 84f9420e (015597d5), 9813efd1 (bd4b1ce7), 1c6d107e (3d2e8537), 25405bfc (e677ec5b) and a7a5f0de (e50887a2). Only 2 of 68 rows read 'published'. The tile hides this because mirrorStatus reads the jobs. Code that reads the raw status does not: social-schedule.ts:1966-1967 (cancel) treats p.status 'scheduled' as a live booking. send-to-client/route.ts picks the newest non-cancelled post by raw status.
- Effect: The raw row says a post is still booked when it has already gone out. Any code that reads it without the jobs (cancel, send-to-client, reports) sees a live booking that no longer exists.
- Verified: All 8 posts read status 'scheduled', and each one's publish_job_ids point to a job that is 'published' (3192d68f→1cbe45ea, a7a5f0de→e50887a2, and so on). Counts are 2 published and 21 scheduled out of 68. The status:'published' writes in publish.ts:895 and zernio-webhook.ts:346 go to publish_jobs. The only social_posts 'published' write is social-schedule.ts:308, the import path. Nothing flips a post to published after its job publishes.

## [medium] Cards at With client read 'Passed' because they reached the client before the round stamp existed (live-data)

- Evidence: These content_items are at status client_review with no client_round, no client_rounds and no client_sent: b98b07a3 'Video - 11', c836cf10 'Video - 18', 370209f1 'Video - 10' and ee923633 'Carousel' (Real Deal Property), and 4de414d6 'Shan Minor Edits' (Capila Finance). client_round started being written in workflow.ts:936 in commit 36ca0e08 on 22 Sep; these cards were sent 15-21 Sep. clientHadIt (board-view-core.ts:267) returns false for them, so line 199 prints 'Passed <date>'. Also, 9169e122 (The Glass Den) has client_round=2 but client_rounds=[].
- Effect: Cards sitting in the With client column tell the team they were only passed internally. This is the reverse of the old 'Sent to client' lie.
- Verified: b98b07a3, c836cf10, 370209f1, ee923633 and 4de414d6 are status client_review with delivered_at set and no client_round, client_rounds or client_sent. clientHadIt (board-view-core.ts:265-268) returns false for them, so line 199 prints 'Passed <date>'. 9169e122 has client_round 2, and client_rounds is absent rather than [] (a minor inaccuracy that does not matter).

## [medium] An edit card being revised shows on Post approval in Draft (live-data)

- Evidence: Item c4a82d74 (Jordan Wilson, 'First Shoot'): status draft_uploaded, client_round 2, delivered_at 24 Sep, scheduler_ids [54ec9a10…], no posts. board-view-core.ts:601 admits any card with scheduler_ids onto the scheduler page, and groupByLane (lines 782-786) puts a handed-over early card in Draft.
- Effect: Post approval shows an editor's card that is back in revision after client changes. It sits in Draft labelled 'Sent to client 24 Sept', which mixes the edit's approval with the post's.
- Verified: c4a82d74 reads status draft_uploaded, client_round 2, client_rounds [2], delivered_at 2026-09-24, scheduler_ids [54ec9a10], and has no posts. The scheduler filter at board-view-core.ts:599-603 admits any card with scheduler_ids. In groupByLane (lines 780-786), handed && early sends it to Draft. clientHadIt is true, so the card reads 'Sent to client 24 Sept'.

## [low] Records left behind by deleted cards (live-data)

- Evidence: Rows whose item_id is not in content_items: 44 social_posts (11 of them 'scheduled', e.g. cf461fe2, 9dfc706e, c6ad5cfd), 25 publish_jobs (8 failed), 14 schedule_entries (8 still 'scheduled', e.g. 034bda63, 36f7f8cb) and 14 post_analytics rows (5 with item_id missing entirely). Nearly all belong to 100 Hundred Million Group. api/production/items/[id]/route.ts:407 removes schedule_entries, item_comments, asset_versions and approvals on delete, but not social_posts or post_analytics.
- Effect: The Schedule page hides these (social-schedule.ts:2043), but anything else that reads the tables directly counts phantom booked or failed posts.
- Verified: The delete route (api/production/items/[id]/route.ts:407-409) removes only schedule_entries, item_comments, asset_versions and approvals; it cancels queued jobs but leaves social_posts and post_analytics rows. Live orphans today: 46 social_posts (13 scheduled), 25 publish_jobs (8 failed), 14 schedule_entries (8 scheduled) and 15 post_analytics rows (5 with no item_id). That is slightly more than the counts reported, but the finding holds.

## [low] Posts sent to the team for approval are recorded as sent to the client (live-data)

- Evidence: social-schedule.ts:1241 sets approval_mode 'client' on every send-for-approval, whatever opts.client_too says. Live example: post e410ee80 on item da697908 ('Justin 3') reads approval_mode=client, but the item's posting_client_required=false and client_sent is unset.
- Effect: No screen reads approval_mode today (a grep found no reader), but the post record claims a client approval route it never took.
- Verified: social-schedule.ts:1241 always sets approval_mode:'client' inside the send claim. Live: post e410ee80 reads approval_mode 'client' while item da697908 reads posting_client_required=false with no client_sent. A grep found no reader beyond comments. Low.

## [low] Stale booking time kept on schedule rows (live-data)

- Evidence: schedule_entries 48f70493 (item 789e612c) has scheduled_at 2026-09-22T08:34:06, which is the time of cancelled job 41ee4e5d. The post actually went out at 09:45 via job 3d2e8537. Row c8fd52cf (item 054e0959) has no scheduled_at at all.
- Effect: Any view built on scheduled_at shows the wrong booked time for posts that were rebooked.
- Verified: 48f70493 has scheduled_at 2026-09-22T08:34:06.642Z, the exact scheduled time of cancelled job 41ee4e5d. The published job 3d2e8537 was scheduled 09:45 and published 09:46:36. c8fd52cf has no scheduled_at. Low.

