# Owner decisions — these OVERRIDE SPEC.md where they differ (29 Sep 2026)

Read this first, then SPEC.md, then AUDIT_EVIDENCE.md (what broke and why — the lessons), then RESEARCH.md.

## Pages
1. **Two separate pages, two jobs.** Post approval (/dashboard/scheduler) = getting a post approved: Draft, Quality
   check, With client, Approved. Schedule (/dashboard/social/schedule) = getting approved posts out: Ready to post,
   Booked in, Posted, and missed times. No approving on Schedule, no booking on Post approval. Both read the one stage.
2. **Popups may be redesigned** wherever a layout makes a decision hard ("feel free to change the layout if a popup
   is not making sense"). The post window: top = stage and what happens next; middle = the post (slides, caption,
   networks, time); bottom = only the buttons this stage allows, identical wherever it opens. A question or error
   appears next to the button that caused it, never below the fold.

## Roles
3. **Quality check is REQUIRED.** Every post passes the quality reviewer (Joy, the quality_checker role, or a super
   admin acting as reviewer) before it can go to the client or to Ready to post. REMOVE SPEC T2's
   "confirm_unchecked" skip: Send to client exists only from quality check (T4) or after a pass. An account manager
   who is not the reviewer cannot pass it.
4. **Schedulers** build posts, send them to quality check, and — once a post is Ready to post or Booked in — book it,
   move its time and cancel it (ANY post, not only their own: fix SPEC T20).
5. **Account managers / super admins** may do everything a scheduler may, send to the client, and approve for the
   client — recorded as "Approved for the client by <name>", with how the client agreed (call, email, WhatsApp);
   never shown as "Client approved".
6. **Client approval is OPTIONAL, per post, for every client.** The team chooses whether to send. A post sent to the
   client may still be approved by the team without waiting; the client's review page then says it was decided.
7. **Editors and designers** are not in the posting flow. Their EDIT approval never moves a post. An upload straight
   from Schedule is itself a post.

## Content rules
8. **Frozen versions.** Sending to quality check or the client freezes files + caption + networks + slide order + time
   as version N. Reviewer and client only ever see the frozen version. Any content edit makes a new draft version and
   clears earlier approvals. A time-only change after approval keeps the approval (SPEC T13/T15 stand).
9. **Notes are per file/slide from the first build** ("comment is per file"), plus notes on the whole post. Two
   threads: Team (default, never shown to the client) and Client. Every "change asked" goes to a named person.
10. **Instagram carousel capped at 10** through the API. The window refuses the 11th and offers: drop slides, split
    into two posts, or give Instagram its own ≤10 while LinkedIn/TikTok keep more (per-network media).
11. **Missed time**: an "approve by" time on client posts; reminders 24h and 1h before; when it passes the client's
    approval closes and the post shows a visible "Missed — needs a new time". Nothing moves by itself. Never hand the
    provider a time already passed (Zernio publishes those immediately). A late approval never posts on its own.

## From the research (must have)
12. One list of stage names/colours/words that every page and the portal reads.
13. Approval steps chosen per client (Loomly-style): team only, or team then client — the default for a post, still
    overridable per post (decision 6).
14. Auto-assign on stage change so the next person is always notified; private team notes by default.
15. One client link listing everything waiting on them; one batched email per round, not one per post.
16. Instagram grid preview in the review page and the post window (should have — build if time allows).

## Process lessons from the audit (why the old pages broke)
- One source of truth: the post's `stage`, written only by `app/lib/post-stage.ts`. No page derives a stage from
  content_items.status, posting_approval_state, client_sent, delivered_at or job status.
- Buttons and columns come from the same function (`postActions` / `laneOf`) — a card is never drawn in one column
  and acted on as another.
- Approval is per POST, not per card — siblings never affect each other.
- Every stage × role has a way forward (the `no-dead-ends` test).
- Labels state facts that are true: "Sent to client" only when it was.
- Test the journey in a real browser (Playwright on the ZZ E2E Test Client, test accounts only) — the 5,700 logic
  tests passed while buttons and popups were broken.
