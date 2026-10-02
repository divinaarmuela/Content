# One portal, one link — build spec

The owner, 2 Oct 2026: *"we are planning to make everything in one portal one link … the reason is because we
have been sending them unique links."* Top priority, built beside the live system and launched only after every
role is walked end to end in the browser.

Status: **SPEC — nothing built yet.** Every decision below marked *(owner)* is the owner's; everything else is a
build choice and may change if the code says otherwise.

---

## 1. Rules (the owner's answers)

| # | Rule | Source |
|---|---|---|
| R1 | One link per portal owner — the client's existing share token (business) or a person's token. One page, four tabs: **Shoot brief · Editing · Designing · Scheduling**. | owner |
| R2 | Posts: **Draft → quality check → booked**. No client step before booking. ALL clients (the "This client signs off every post" switch retires at launch). | owner |
| R3 | The client approves **after** booking, per post, in the Scheduling tab: **Approve** or **Not approved** (+ note). | owner |
| R4 | **Not approved** → off the schedule at once, back to the team. Whoever made the post and whoever it is assigned to are told. They see the client's comments, can change media, and re-send with the usual choice **Team only / Share with client**. It goes through the quality check again. | owner |
| R5 | Each post carries a choice set by the team: **If the client hasn't approved: Post anyway (default) / Wait for the client.** | owner |
| R6 | **Post anyway**, no answer → one reminder email to the client, then it posts as booked. | owner |
| R7 | **Wait for the client**, no answer by 15 min before its time → taken off the schedule, maker + assignee told; it keeps waiting on the client's link. | owner (as understood, 2 Oct) |
| R8 | **Any client answer inside the last 15 minutes** moves the post to the next free 15-minute slot first, then applies the answer (approved → posts at the new time; not approved → off the schedule). A late approval of a "Wait" post that came off is booked for the next 15-minute slot. The team is told the new time. | owner |
| R9 | A post changed after the client approved **keeps** the approval. If the team sends it to the client again, it shows there for review again. | owner |
| R10 | The Scheduling tab shows **all** booked posts and all posted ones (ours + those posted outside the app, from Zernio), always — not only after a send. | owner |
| R11 | Instagram as a **profile grid**, LinkedIn as a scrolling **feed**, TikTok as a **grid**. Tap a posted post → its stats. Tap a booked post → approve / not approved. | owner |
| R12 | **Send the preview** (team page) is the email that tells the client to look. | owner |
| R13 | Editing and Designing tabs are independent of Scheduling; approving a video or design and then the post is fine. | owner |
| R14 | Nothing live changes until launch: the new page and the new posting order are on only for TEST clients (100M, ZZ E2E, ZZ TEST - Workflow). No email to a real client or team member from a test. | owner |

Open: the reminder's timing — proposed **24 h before posting, or at once if booked less than 24 h ahead**.

---

## 2. The switch

- `clients.portal_one` (ghost column, boolean, default null = off). On for the three test clients during the build.
  At launch it is turned on for everyone (one write per client, reviewed with the owner).
- Every new behaviour reads it through ONE pure function, `onePortal(client)` — the new page, the new posting
  order, Send the preview, the reminders. Off → the code path is exactly today's.
- The new page answers 404 when the switch is off (so a guessed address shows nothing).

## 3. The page — `/portal/[token]/home` during the build

At launch the root `/portal/[token]` points at it and the old deep links (`/edit/…`, `/post/…`, `/shoot/…`,
`/approve/…`) redirect into the right tab, so links already in clients' inboxes keep working.

Shell (same look as today's portal: `PortalShell`, `.dbx`, Archivo / Sometype, `--p-*`, light/dark pill):
- Header: MD Media · the portal's name (business, or the person). The four tabs as a sticky pill row; a count
  badge on each tab = what is waiting on them there.
- `?tab=shoot|editing|designing|scheduling` opens a tab; `&id=` opens one thing in it. Every email links here.
- Live: `PortalLive` on both the `production` and `schedule` channels (today posts only arrive on the 120 s poll).
- Scope: every tab filters by `belongsToPortal` — a person sees only their own work (today `board`, `approve`,
  `team-board` and the comment route check the client only).

### Tab: Shoot brief
- The shoots shared with them (`getPortalData` shoots, the same rule as today: shared or locked/shot/wrapped).
- Each: the plan card (`PortalCardView`: plan, PDF, Approve / Ask for a change), the board (`ShootBoard`) when
  shared, the comment thread. Empty: "No shoot plans to look at yet."

### Tab: Editing
- Video cards at a client-facing stage (`isClientFacing`) that are not graphics. A list: title, version, state
  ("Needs your review" / "Changes in progress" / "Approved"), the newest still.
- Opening one shows today's `EditingReview` inside the shell (versions, per-clip approve, Approve Version N — all,
  Ask for a change, comments). Same API (`/api/portal/clip`, `/api/portal/act`, `/api/portal/comment`).
- Files still copying in → "Your edit is on its way" (as today).

### Tab: Designing
- The same for graphics cards (`work_kinds.slug = graphics`), pictures shown, no timeline (as fixed 1 Oct).

### Tab: Scheduling
- One sub-tab per connected network the client has (Instagram / LinkedIn / TikTok; others later).
- **Instagram** — a profile: avatar, handle, then a 3-column grid, newest first. Booked posts on top in their
  booking order (as the Schedule page's Preview), each tile marked with its date and a state dot:
  *Approved* · *Not reviewed yet* · *Not approved — off the schedule*. Posted ones below.
- **LinkedIn** — a scrolling feed of full post frames (`PostPreviewFrame`, 1.91:1 / carousel / video).
- **TikTok** — a 3-column grid of 9:16 tiles.
- Tap a **booked** post → the post in its network's frame (`PostPreviewPane`), the date and time, the comment
  thread, and **Approve** / **Not approved** (a note is required for Not approved). Inside the last 15 minutes the
  answer bumps the post first (R8) and says so.
- Tap a **posted** post → the frame + stats from the cache (`post_analytics`: views, reach, likes, comments,
  shares, saves, the day graph) — the same numbers as today's portal post page. Never a live Zernio call from the
  page (the cache is refreshed every 30 min).
- Posted outside the app → shown from the cache with stats, no approve.

## 4. The posting order behind the switch (engine: `post-stage-core.ts` / `post-stage.ts`)

New fields on `social_posts` (ghost columns):
- `if_no_answer`: `'post' | 'wait'` (null = post).
- `client_review`: `{ version, verdict: 'approved' | 'not_approved', note, by, at }` — the client's word on a
  booked post. Separate from `approval` (the team's pass, which booking needs).
- `review_asked`: `{ version, at, by }` — set by Send the preview / Share with client; the tab shows "Not reviewed
  yet" for a post asked and unanswered.

New actions (client hat unless said):

| Action | From → to | Effect |
|---|---|---|
| `client_ok` | booked → booked | writes `client_review` approved. Inside the last 15 min: bumps first. |
| `client_not_approved` | booked → draft | cancels the Zernio job (refused if live/publishing — then "It has already gone out — your account manager has been told"), booking = null, changes_asked {who: client}, notifies maker + assignee. Inside the last 15 min: bumps first. |
| `client_ok` on a Wait post that came off | ready → booked | books the next 15-minute slot, tells the team. |
| `hold_for_client` (system) | booked → ready | a Wait post with no approval 15 min before: off the schedule, maker + assignee told. |
| `set_if_no_answer` (team) | draft/quality_check/ready/booked | sets R5's choice. |

With the switch on: `pass` books (as today's auto-book), `pass_send_client` / `with_client` are not offered,
approval steps are always `team`. Off: nothing changes.

## 5. Team side

- **Post window**: the R5 choice ("If the client hasn't approved") beside the time; the client's word as a chip
  (Approved by the client · Not reviewed yet · Not approved — with the note); "Changed since the client approved"
  when the frozen version moved past `client_review.version`.
- **Not approved** lands the post in Draft with the client's note at the top (as `changes_asked` does today),
  Change media, then "Send for quality check" with **Team only / Share with client**.
- **Send the preview** (Schedule page, per client): shows exactly the client's Scheduling tab, lists who will be
  emailed (the client's portal recipients), Send → one email linking `?tab=scheduling`, `deliberateClientSend`,
  sets `review_asked` on every booked post not yet answered. Logged; no double send (dedupe per client per hour).
- **Reminders**: an Inngest sweep — Post anyway posts asked and unanswered, 24 h before (or at once if later than
  that); Wait posts 15 min before → `hold_for_client`.

## 6. Loopholes and how each is closed (2 Oct 2026)

| # | Loophole | Closed by |
|---|---|---|
| L1 | Two people answer differently (business link vs a person's link) | latest answer wins; every answer kept on the post's history; the team told when the answer changes |
| L2 | A forwarded link answers | a name on every answer (as today), kept with it |
| L3 | The client answers an old version the team just edited | every answer carries the version seen; a stale one is refused: "This post was just updated — have a look again" |
| L4 | Not approved after it went out | refused with "This has already been posted — your account manager has been told"; the team told |
| L5 | One post, several networks | one answer for the post; Not approved takes every network off; live on one and not the other → refused with words |
| L6 | The bump lands on a taken slot, or Zernio is already publishing | "next free" = no other post on that channel at that time; publishing → L4 |
| L7 | Instagram Stories are not in the grid and vanish in 24 h | a row of story circles above the grid |
| L8 | Client emails are hard-switched off except deliberate sends | Send the preview and the client reminder are deliberate sends to the portal's recipients; no recipient / no link → the button says so; deduped |
| L9 | Links already in inboxes after launch | old deep links redirect into the right tab |
| L10 | Person links see business work (some routes check the client only) | every tab checks `belongsToPortal` |
| L11 | "Wait" posts nobody answers pile up | Post approval shows "Waiting on the client — N days" so the team can chase or switch to Post anyway |
| L12 | Stats lag (cache every 30 min) | a just-posted post reads "Numbers arrive within the hour", never zeros |

What shows on the Scheduling tab: booked — until posted, taken off or cancelled; posted — the newest per account
(about 25, Zernio's depth, as the Schedule page's Preview); not approved — under "Not approved" with the note
until re-sent or cancelled; cancelled — never.

## 7. Who does what (every role, with the switch on)

| Role | Their part | What is new for them |
|---|---|---|
| Editor | edits; hands in from Drive; answers the client's video notes | nothing — the client now reviews in the Editing tab instead of a separate link |
| Designer | uploads designs; answers the client's design notes | nothing — the Designing tab instead of a separate link |
| Scheduler / general | makes the post (or gets the handed-over drafts), time, channels, caption, **"If the client hasn't approved: Post anyway / Wait for the client"** (default Post anyway), Send for quality check | told when the client says Not approved on a post they made or hold; fixes it from Draft and re-sends |
| Quality checker | Passed → **booked straight away** (today's auto-book). A pass inside the last 15 minutes books the next free 15-minute slot instead of "Missed — needs a new time", and says the new time | no more missed posts at the check |
| Account manager | owns the client: **Send the preview** (the email), sees every client answer, chases "Waiting on the client", can record the client's answer for them when it came by phone or WhatsApp | the Scheduling column of client answers; Send the preview |
| Super admin | all of the above; turns the switch on per client at launch | the switch |
| Client (business link) | the four tabs; Approve / Not approved on booked posts; stats on posted ones | one link for everything |
| Client person (their own link) | the same four tabs, **only their own work** — their own shoots, cards and the posts made from them | — |

Decided (build choices, 2 Oct 2026): reminder = 24 h before posting, or at once if booked later than that; a
person's link answers only for their own work; Send the preview may be pressed by an account manager, a scheduler
or a super admin; the client's answer is shown to everyone on the post, and Not approved emails the maker and the
assignee (owner's rule) — account managers see it on the board.

## 8. Build order — each stage gated (tsc, build, all tests) and walked before the next

Work on branch `one-portal`; a stage merges to main only when the switch-OFF path is proved unchanged by tests,
and only test clients have the switch on.

1. **Foundation** — `clients.portal_one`, `social_posts.if_no_answer / client_review / review_asked` (ghost
   columns); `one-portal-core.ts` (pure): `onePortal()`, `nextFreeSlot()`, client-answer guards, tab filters,
   scope. Unit tests. No UI.
2. **Engine** — the new actions behind the switch (client_ok, client_not_approved, hold_for_client,
   set_if_no_answer, pass-books-with-bump), `/api/portal/act` accepts them, the notifications. Tests prove the
   switch-off path is byte-for-byte today's.
3. **Portal shell + Shoot brief / Editing / Designing tabs** at `/portal/[token]/home` (reusing today's
   components). Browser walk: client business + person links, light/dark, phone.
4. **Scheduling tab** — Instagram grid (+ story circles), LinkedIn feed, TikTok grid, the post sheet, stats from
   the cache. Browser walk.
5. **Team side** — the choice + client-answer chip in the post window, Not approved landing in Draft with the
   note, Send the preview, "Waiting on the client" on Post approval, the reminder sweep. Walk per role.
6. **End-to-end walk** — every role in §7 on 100M / ZZ E2E, every state, screenshots; the report to the owner.
   Launch only on the owner's word: switch on for all clients, old deep links redirect, emails point at the tabs.

## 9. Tests and walks before launch

- Pure rules unit-tested (`one-portal-core.ts`): the switch, the bump (next free 15-min slot), every new action's
  guard, the tab filters per scope.
- Every route pinned for the switch-off path (old behaviour byte-for-byte).
- Browser walks on 100M / ZZ E2E as: account manager, editor, designer, quality checker, scheduler, super admin,
  the client (business link) and a person link — every tab, every state, light and dark, phone width.
- Emails: only test addresses; the test-client mail guard checked before any send.
