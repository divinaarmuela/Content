# Posting flow rebuild spec: Post approval, Schedule, the post window and the client review

28 to 29 Sep 2026. This covers /dashboard/scheduler, /dashboard/social/schedule, `NewPostDialog` and `/portal/[token]` post review.

**Where this comes from.** It rests on 82 confirmed findings (IDs are in §9) and the six area maps. I ran a few checks of my own, all read-only:
- The posting files exist where the maps say.
- `workflow-core.ts` has the shape used as the model: `TRANSITIONS` at :69, `checkTransitionAs` at :321, `presentTransitions` at :425.
- `social_posts` is a ghost table in `scripts/gen-db-types.mjs:87-114`.
- The Instagram limit of 10 per carousel is already in `app/lib/publish-core.ts:73-77`.
- Playwright `^1.62.1` is in `package.json:79`. It is used only by `scripts/check-mobile.mjs`. There is no `playwright.config` and no `e2e/` directory.

I did not re-read the live data myself. Every row id cited below comes from the verified findings.

---

## 1. Principles

1. **The post is the unit.** A post is one `social_posts` row. Its stage lives in **one field**, `social_posts.stage`. The Post approval board, the Schedule grid and list, the post window, Waiting on you, the Overview tiles and the client portal all read that field. None of them reads `content_items.status`, `posting_approval_state`, `posting_client_required`, `client_sent` or `delivered_at` to decide where a post is.
2. **One pure transition function.** `app/lib/post-stage-core.ts` is modelled on `workflow-core.ts`: no I/O, a `POST_TRANSITIONS` table, `checkPostTransition`, and `postActions`. Nothing else decides what moves where. Every button on every screen comes from `postActions`.
3. **Post approval is independent of the edit approval.** The edit card (`content_items`) is only a *source of media*. The edit's status never gates, moves or labels a post. The post's stage never moves the edit. An upload straight from Schedule is a post from birth. A quality-check pass on it is the post's approval.
4. **Frozen versions.** Sending to Quality check or to the client freezes files, per-channel slides, caption, channels and time as version N in `post_versions`. Reviewers and the client only ever see a frozen version. Any edit after that works on draft version N+1.
5. **No check-then-write (trap 11).** Every stage change is one `table('social_posts').claim()` that checks `stage` and `rev` (it runs `checkPostTransition` inside the claim).
6. **No dead ends.** Every stage offers at least one way forward to the people who own it, including Cancelled (Re-book) and Posted with failures (Post the missing networks).

---

## 2. Data model

### 2.1 `social_posts`: the post (ghost table, edit `scripts/gen-db-types.mjs:87`)

| Field | Type | Meaning |
|---|---|---|
| `id`, `client_id`, `created_by`, `created_at`, `updated_at`, `timezone` | keep | |
| `source_item_id` | string, nullable | Renamed from `item_id`. The edit card the media came from. Informational only; the stage never reads it. `item_id` is kept as an alias until migration P8 finishes. |
| `source_deleted` | bool | The source card was deleted. The post stays visible (fixes S9, L6). |
| **`stage`** | `'draft'\|'quality_check'\|'with_client'\|'ready'\|'booked'\|'posted'\|'cancelled'` | **The only source of truth.** |
| `rev` | number | Bumped on every write. Every claim checks it (optimistic concurrency). |
| `stage_at` | ISO | When the post entered this stage. This is the "since" date (fixes B14). |
| `draft_version` | number | The version number the working copy will become when frozen. |
| `slides`, `per_channel`, `channels`, `caption`, `scheduled_for`, `version_id`, `version_number` | keep | The **working copy**. It is editable only in `draft`, and in `ready` for a time-only change. `per_channel[net].slides` holds per-network slides. |
| `sent_version` | number, nullable | The frozen version currently with Quality check or the client, or the one approved. |
| `approval` | `{version, by, hat, on_behalf_of_client, note, at}` or null | Who approved which version. When a manager approves for the client, it is recorded as the manager's, with `on_behalf_of_client: true`. |
| `qc_pass` | `{version, by, at}` or null | Whether that version was checked. This drives "Not checked yet — send anyway?". |
| `changes_asked` | `{version, by, who:'client'\|'team', note, at}` or null | Fixes B6 and P13: the screen knows who asked. |
| `client_send` | `{version, at, to[], via:'email'\|'link', delivered:bool}` or null | This is per post and per version. It is cleared by any move out of `with_client` (fixes B4, B16, V9, P9). |
| `booking` | `{job_ids[], at, for_time}` or null | `job_ids` includes re-send children (fixes V11). |
| `outcomes` | `{[platform]: {status:'published'\|'failed'\|'duplicate'\|'scheduled', url, at, error}}` | **Per network.** The publish recorder is its only writer (fixes S5, S7, S15, L1, L2). |
| `problem` | string, nullable | A plain sentence: why it came back from booked, or a lost channel. |
| `cancelled` | `{by, at, from_stage, reason}` or null | |

**Delete these fields from `social_posts`:** `status`, `sent_at`, `approved_at`, `approved_by`, `approval_mode` (fixes V19, L7) and `publish_job_ids` (moves into `booking.job_ids`).

### 2.2 `post_versions`: new ghost table, append-only

| Field | Meaning |
|---|---|
| `id` | `${post_id}_v${n}`. Unique by construction: the first writer wins with `claim()` against a null current. |
| `post_id`, `n` | |
| `slides`, `per_channel`, `channels`, `caption`, `scheduled_for`, `timezone` | Deep copy at freeze time. File URLs point at immutable stored copies, never at a Drive link (see memory: files, not Drive links). |
| `frozen_for` | `'quality_check'\|'client'\|'retime'\|'migration'` |
| `frozen_by`, `frozen_at` | |
| `from_migration` | bool. The portal shows "Sent before versions were kept". |

### 2.3 `post_events`: new ghost table, append-only log

`{id, post_id, rev, from, to, action, actor_id, hat, on_behalf_of_client, version, note, at}`

It replaces the posting rows in `workflow_activity`. This is where History, "who asked" and audit are read from.

### 2.4 `post_comments`

Client and reviewer notes carry `post_id` and `version`. They are scoped to that post's version and are never taken from `item_comments` (fixes P10). The `item_comments` table stays for the edit.

### 2.5 `content_items`: what the posting flow stops using

- **Delete after migration:** `posting_approval_state`, `posting_client_required`, `client_sent`. A test pins that nothing reads them (§8.3).
- `status` stays the **edit's** status. `scheduled` and `published` become a **derived roll-up**: "has a booked post" and "every network of every live post posted". One writer maintains them (`recordPostOutcome`, package P2), and only the editor board and history read them. The posting pages never do.
- `delivered_at` and `client_round`/`client_rounds` belong to the edit only. The board's "Sent to client" line is removed from post cards (fixes B4, L4).
- `adhoc_post` cards stay only as the file holder for a Schedule upload. Their status is not read by any posting surface, and they never appear on the Post approval board (fixes V13).

### 2.6 Edit freeze (for P1, which is an edit bug with the same root cause)

At the edit's `quality_check → client_review` transition, `performTransition` writes `content_items.client_frozen = {round, at, files:[{asset_id, version, url}]}`. The portal's edit page reads `client_frozen.files` instead of `liveFilesAt(...)` (`portal-thread.ts:261`).

---

## 3. The transition table (`app/lib/post-stage-core.ts`)

**Hats:**
- `creator`: the person who made the post.
- `scheduler`: the post's assigned scheduler, or the scheduler hat.
- `am`: account manager.
- `qr`: quality reviewer.
- `sa`: super admin. May do anything a team hat may.
- `client`: the portal token holder. Valid only for the `client` rows below.
- `system`: the publish recorder.

**Guards used below:**
- `valid`: `validateComposition` passes. That means media, channels, per-network caption limits, Instagram carousel of 10 or fewer per network (`publish-core.ts:77`), and per-network slides allowed.
- `timeOk`: the time is 15 or more minutes ahead, or the action is Post now.
- `channelsLive`: every channel is connected.
- `versionMatch`: the version the actor saw equals `sent_version`. The act endpoint takes `version` and rejects a stale page.
- `slotOpen`: `now < version.scheduled_for`.

| # | From → To | Action (button) | Who | Guard | Side effects |
|---|---|---|---|---|---|
| T1 | draft → quality_check | Send for quality check | creator, scheduler, am, sa | valid, time set | Freeze vN (`quality_check`); set `sent_version`; notify quality reviewers; event |
| T2 | draft → with_client | Send to client | am, sa | valid, timeOk, client has a contact; **if no `qc_pass` for this content, the request must carry `confirm_unchecked:true`** | Freeze vN (`client`); email or link; set `client_send` only after at least one delivery succeeds, else the transition is refused and nothing changes (fixes P9); event |
| T3 | quality_check → ready | Passed | qr, sa | versionMatch | `qc_pass` and `approval` set to `{hat:'quality_reviewer'}`. This is the post's approval, including for Schedule uploads |
| T4 | quality_check → with_client | Passed — send to client | qr, am, sa | versionMatch, timeOk | `qc_pass` (only if the actor is qr or sa, otherwise T2's unchecked confirm applies); send as in T2 |
| T5 | quality_check → draft | Ask for a change | qr, am, sa | note required | `changes_asked{who:'team'}`; `draft_version = N+1` |
| T6 | with_client → ready | Approve (portal) | client | versionMatch, slotOpen, stage is `with_client` **for this post** | `approval{hat:'client'}`; email the team. Refused on any post not in `with_client` (fixes V5, P3) |
| T7 | with_client → ready | Approve for the client | am, sa | versionMatch | `approval{hat:<own>, on_behalf_of_client:true, note:"how the client said yes"}` |
| T8 | with_client → draft | Ask for a change (portal) | client | versionMatch, slotOpen | `changes_asked{who:'client'}` |
| T9 | with_client → draft | Take back | am, sa, scheduler | none | `client_send` cleared; the portal link now says "The team took this back" |
| T10 | with_client → with_client | New time and resend | am, sa | slot missed or time change wanted; timeOk | Freeze vN+1 (`retime`, same files and caption); new `client_send`. **Nothing moves by itself when the time passes.** A missed time is derived at read time (`slotMissed(post, now)`). It closes T6 and T8 for the client and puts "Needs a new time" on the card for the team |
| T11 | ready → booked | Book in | scheduler, am, sa | `approval.version == sent_version`, timeOk, channelsLive | See §3.1 |
| T12 | ready → booked | Post now | scheduler, am, sa | approval as T11, channelsLive | As T11 with the time set to now |
| T13 | ready → ready | Change time | scheduler, am, sa | timeOk | Writes vN+1 (`retime`) carrying the approval forward, with `event.note="time changed after approval"`. If `approval.hat=='client'`, an FYI email goes to the client. A time change is not a content change, so no re-approval |
| T14 | booked → ready | Take off the schedule | scheduler, am, sa | no network live | Cancel the provider job(s) first, then claim. Refused if any network already went out |
| T15 | booked → booked | Change time | scheduler, am, sa | timeOk | Provider reschedule. The approval stays (as T13) |
| T16 | booked → posted | (system) | system | every targeted network's outcome is published or duplicate, or the job is finished | `outcomes` per network; roll up the item (see §2.5) |
| T17 | booked → posted (partial) | (system) | system | at least one network published, at least one failed | `problem = "Did not go out on LinkedIn: …"`. The card offers T21 |
| T18 | booked → ready | (system) | system | every network failed, or the job was lost | `problem` set; the booking is cleared. The person re-times and re-books |
| T19 | draft, quality_check, with_client, ready → draft | Edit | creator, scheduler, am, sa | none | Start draft vN+1 from vN. `approval` and `client_send` stay only in history. From with_client the client link shows "The team is changing this" |
| T19b | booked → draft | Edit | scheduler, am, sa | no network live; confirm "This takes it off the schedule" | Cancel the job, then T19 |
| T20 | any except posted, cancelled → cancelled | Cancel post | creator, am, sa (scheduler if they created it) | no network live | Cancel provider jobs; `cancelled{from_stage}`. **Does not touch other posts or the item** (fixes V2, V20) |
| T21 | posted → draft (new post) | Post the missing networks, or Duplicate | scheduler, am, sa | none | Creates a **new** post. The working copy is the posted version limited to the failed networks (or all of them for Duplicate). A missing-networks copy is born `ready` carrying the same approval; a Duplicate is born `draft` |
| T22 | cancelled → draft | Re-book | creator, scheduler, am, sa | none | Working copy is the last version, time cleared; `cancelled` kept in history (fixes W2, V3) |
| T23 | draft (never frozen) → *deleted* | Delete draft | creator, am, sa | `sent_version == null && booking == null` | Hard-delete the row and its unfrozen media claim (fixes S1). Anywhere else the bin is Cancel post |

### 3.1 Booking order (fixes V14, V15, W4)

1. Claim `ready → booked` with `booking = {job_ids:[], pending:true}`.
2. `queuePublishJob` wrapped in try/catch.
3. On success, claim `booking.job_ids` and `pending:false`.
4. On any error or throw, claim back to `ready` with `problem`.
5. **Only then** send the booking email and return `{post}` to the window.

The window's "Booked in for …" line is drawn from the returned `post.stage`, never assumed.

### 3.2 Pure exports

- `POST_STAGES`
- `STAGE_LABEL`, `STAGE_MEANING`, `STAGE_TONE`
- `POST_TRANSITIONS`
- `checkPostTransition(post, action, actor, ctx:{now, confirmUnchecked?})` returns `{ok}` or `{ok:false, reason}`
- `postActions(post, viewer, now)` returns `{primary, secondary[], danger?}`. This is **the** button list for every surface.
- `waitingOn(post, now)` returns `{who:'you'|'quality check'|'client'|'nobody', line, since: stage_at}`
- `slotMissed(post, now)`
- `laneOf(post)`, which is `post.stage`, one line and no rewriting (fixes B1, B9, B10, B11, B12, B13)

---

## 4. Pages: layout and buttons per stage and role

### 4.1 One post window (`PostWindow`, replacing `NewPostDialog`)

It opens the same way from a Schedule tile, a list row, a Post approval card, a Waiting row and the portal preview (team only). The footer is `postActions(post, viewer)` rendered as-is. There is no `reviewOnly` branch (fixes W6) and no dead `sendToClient` (fixes W10).

**Header:** the stage chip (`STAGE_LABEL[post.stage]`, tone from the stage), `waitingOn(...).line`, and a "Version N · frozen <date>" link that opens the frozen copy. It never reads `content_items` (fixes B5).

**Body:**
- Working copy is editable in `draft`.
- In quality_check, with_client, ready and booked the body shows the **frozen version** read-only, with a single "Edit (makes version N+1)" (T19). This fixes the "saving files asked for a new time" case: saving media in a draft never asks for a time. Only a send or book validates the time.
- Per-network slides tab: Instagram capped at 10, with a counter.

**Footer by stage:**

| Stage | Creator / scheduler | AM / SA | Quality reviewer |
|---|---|---|---|
| draft | **Send for quality check**; Save; Delete draft (never frozen) or Cancel post | **Send for quality check**; Send to client (with unchecked confirm); Save; Delete or Cancel | — |
| quality_check | Edit; Cancel | **Passed — send to client**; Ask for a change; Edit; Cancel | **Passed**; Passed — send to client; Ask for a change |
| with_client | Take back | **Approve for the client** (note); Take back; New time and resend (primary when the slot is missed); Cancel | — |
| ready | **Book in**; Post now; Change time; Edit; Cancel | same | — |
| booked | Change time; Take off the schedule; Edit (confirm); Cancel | same | — |
| posted | Post the missing networks (if partial); Duplicate | same | — |
| cancelled | **Re-book**; Duplicate | same | — |

**TimePicker:**
- A "Now" chip, which calls T12 when the post is in `ready`. Otherwise Now is disabled with the reason in its title: "Approve first".
- Minutes in 5-minute steps plus any existing off-step minute kept as an option (fixes W9).
- The default time is the next quarter-hour at least 15 minutes out, not 6 pm (fixes W9).
- Past hours are disabled.
- The TOO_SOON text only mentions Post now when Post now is actually offered (fixes W3).

**Behaviour fixes:**
- The focus-trap effect depends on `[picking]` only and never focuses the card after mount (fixes W1).
- `problems` is cleared on opening the picker (fixes W7).
- Problems render above the confirm row, never hidden by it (fixes W8).

**Send to client:** always the unchecked confirm. If `qc_pass?.version` does not equal the version about to be frozen, the window shows "Not checked yet — send anyway?" with the buttons [Send anyway] [Send for quality check instead].

### 4.2 Post approval board (/dashboard/scheduler)

- **Cards are posts.** Lanes, in order: Draft · Quality check · With client · Ready to post · Booked in · Posted. There is also a collapsed "Cancelled" filter.
- A card's lane is `post.stage`. Drag and drop onto a lane is the matching action from `postActions`, or it is refused with `checkPostTransition`'s reason. The Move menu is the same list. The toast is "`<action>` — now in `STAGE_LABEL[result.stage]`", read from the server response (fixes B1, B2, B9).
- **Card face:**
  - Title, client and network logos (all of them).
  - `waitingOn.line` with `since stage_at` (fixes B14).
  - A missed-slot badge when `slotMissed`.
  - `changes_asked` shown as "Joy asked for a change" or "The client asked for a change" (fixes B6).
  - A client-send chip only from `client_send` of the current version: "Emailed to Jordan 28 Sep" (fixes B4, B16).
  - The approval line reads "Approved by the client" or "Approved by Akmal for the client" (fixes P6).
  - For the primary button, see §4.1. A post in `with_client` never shows Approve as primary; the manager's option is labelled "Approve for the client" (fixes B7).
- **Source tray** above the board, not a lane: "Edits ready to become posts". These are edit cards at `approved_for_scheduling` that have no live post, with a "Make a post" button. Handed-over edit cards still in revision are **not** on this page (fixes B3, L5).
- **Waiting on you** (new `post-waiting-core.ts`) lists every post where `waitingOn(post).who` is the viewer's hat, which includes `draft` with `changes_asked` (fixes B8).
- **Overview tiles and lenses** count `post.stage` (fixes B12).
- **Delete** is offered only per T23 (fixes B15).
- **List view:** one "Stage" column showing `STAGE_LABEL` (fixes B10).
- The `PostApprovalDetail`/`CardSheet` drawer is replaced by the post window (fixes B5).

### 4.3 Schedule page (/dashboard/social/schedule)

- **Grid** (week and month): draws quality_check, with_client, ready, booked and posted, each timed by `scheduled_for` of the frozen version, or the working copy for draft. Draft and cancelled live only in the Drafts and Cancelled lists (fixes S1). The tile tone comes from `STAGE_TONE`. A `problem` or lost channel shows as a visible red "!" chip plus text in the List (fixes S13). Every network logo is shown (fixes S14).
- **Partial posts:** the tile says "Posted on 3 of 4" in amber, never "Did not go out" (fixes S7). Per-network lines come from `post.outcomes` (fixes S15).
- **Stories strip:** a post counts when any `per_channel[net].kind === 'story'` (fixes S3).
- **Filters:** the `channelPosts` memo depends on `owner` and `ownerAccountIds` (fixes S4). A 60-second clock tick feeds `waitingOn`/`slotMissed` (fixes S12).
- **Preview grid:** Instagram only, excluding posted, cancelled and draft-without-time, with posted items drawn only once, from the live feed (fixes S8).
- **Rail:** "used" files come from posts whose stage is in {quality_check, with_client, ready, booked, posted} (fixes S6). Remove this piece is reachable on every rail card, including greyed ones (fixes S11). Removing a piece whose posts are booked is refused with "Take its posts off the schedule first".
- **Edit media:** the launcher saves to the post the user opened. From the week toolbar it asks which post when an item has several, and lists only posts in `draft` (fixes S10).
- **Orphans:** posts with `source_deleted` still show, with a "card deleted" note (fixes S9).

### 4.4 Client review (portal)

**Route:** `/portal/[token]/post/[postId]` (rebuild the existing `app/portal/[token]/post/`).
- It reads `post_versions[sent_version]` only. It never reads the live post or `content_items.caption` (fixes P2, P11).
- The page only opens when `stage === 'with_client'`, or for history when `client_send` existed for some version (fixes P3).
- `?preview=1` is removed from the client route. The team preview is `/dashboard/...` behind Clerk (fixes P4).

**States the page shows:**

| Post state | Client sees |
|---|---|
| with_client, slot open | The frozen version, Approve, Ask for a change |
| with_client, slot missed | "The time for this post has passed — we'll send you a new time." No buttons |
| draft after the client's own T8 | "Thanks — we have your note" |
| draft after a team T5/T9/T19 | "The team is updating this post" (fixes P13) |
| ready or booked with `approval.hat==='client'` | "You approved this" |
| ready or booked approved by the team for the client | "Approved by <name> for you" |
| ready or booked approved by the team without a client send | Not shown to the client |
| posted | "Live on Instagram ↗ · LinkedIn ↗", links from `outcomes` (fixes P5, P6) |

**`api/portal/act`:** `approve_post` and `request_post_changes` take `{post_id, version}`. They call `performPostTransition` with hat `client`. They are refused unless the post is in `with_client`, belongs to the token's client, `versionMatch` holds and `slotOpen` holds (fixes V5, P3).

**Portal home:**
- The "Posts waiting on you" list is the posts in `with_client` with `client_send` set and the slot open (fixes P9).
- Columns come from `post.stage`, mapped as: with_client → Review; ready or booked → Approved or Going out; posted → Done (fixes P12).
- The hero is chosen only from cards in rendered sections (fixes P7).
- `PortalSectionsView` receives only the rendered sections' fields, with no `in_production` media and no unsent cards (fixes P8).
- The edit review page reads `content_items.client_frozen` (fixes P1).

---

## 5. Server: one writer

`app/lib/post-stage.ts`:
- `performPostTransition(postId, action, actor, input, expectRev)`: a claim that runs `checkPostTransition` inside, followed by side effects in the order §3 lists.
- `freezeVersion`
- `bookPost` (as in §3.1)
- `recordPostOutcome(jobId)`, which is per network
- `cascadeItemDelete(itemId)`

There is one route, `POST /api/posts/[id]/act`, with body `{action, expect_rev, version?, confirm_unchecked?, on_behalf_of_client?, note?, scheduled_for?}`. It returns `{post}` or 409 `{reason, post}`.

**Deleted or retired:**
- `posting-approval.ts` and `posting-approval-core.ts` (actOnPostingApproval, the item-wide gate: fixes V1, V2, V4, V17, V18)
- `/api/production/items/[id]/posting-approval`
- `sendForApproval` and `scheduleWithoutApproval` edit transitions (fixes V13)
- `syncFromItem`
- `mirrorStatus` and `statusOf` (fixes S2)
- `bookApprovedPosts`' swallowed errors
- the `notifyPublishQueued` call on `insertPost` (fixes V12)

`/send-to-client` becomes T2/T4 through the act route (fixes V9, V10, W10).

**Other server changes:**
- **Resend:** `resendTimedOut` appends child job ids to `post.booking.job_ids` (fixes V11).
- **Publish recorder:** writes `post.outcomes[platform]` and exactly the `schedule_entries` row for that platform, with that platform's URL (fixes V16, L1, L2, L8). The analytics link back-fill matches by platform (`post-analytics.ts:212-214`).
- **Item delete (`items/[id]/route.ts`):** refuses while any post of the item is `booked` or partly live. Otherwise it cancels unbooked posts (`cancelled.reason='card deleted'`), marks all its posts `source_deleted`, and leaves posted history (fixes V8, L6).

---

## 6. Migration (package P8: `scripts/migrate-post-stage.mjs`)

- Dry-run by default. It writes a backup JSON of `content_items`, `social_posts`, `publish_jobs` and `schedule_entries` to the scratchpad and prints a per-row plan. `--write` applies. It never writes outside `/mdm`.
- It reads jobs through `publish_job_ids` **plus** children found by `resend_of`.

**Per-post rules, first match wins:**

| # | Condition | stage | Other fields | Live rows |
|---|---|---|---|---|
| M1 | stored `cancelled` | cancelled | `cancelled.from_stage = null` | 20 rows, e.g. 11b9a6cc, 5adfb997, 9024fe1c |
| M2 | every targeted network published or duplicate (from `platform_results`) | posted | `outcomes` from platform_results; `approval` from the item's `posting_approved` activity actor | 17 stored 'scheduled' over published jobs (a7a5f0de, bbf70b79, 3192d68f, 34adf560, 84f9420e, 9813efd1, 1c6d107e, 25405bfc, …) and 01444e51, ff85fac3 |
| M3 | a job with some networks published and some failed | posted, partial | `problem` set | e63c744f and 14a42792 jobs, if any post adopts them via resend_of |
| M4 | job status queued, publishing or scheduled | booked | | none live today |
| M5 | stored 'scheduled' with only failed jobs | ready (item live) or cancelled (`source_deleted`) | `problem` | 4e742215, fc3ee75b are orphans, so cancelled with "card deleted"; they stay visible |
| M6 | stored 'scheduled' with only cancelled jobs | cancelled | | 0d892f0f, 1a78c21a |
| M7 | pending, item `posting_client_required` true and `client_sent.stage=='post'` | with_client | freeze v1 `from_migration`; `client_send` from `client_sent` | 2a74c976 (0fc6b6a0), e7f0e7a3 (7f199b2a) |
| M8 | pending, not client | quality_check | freeze v1 `from_migration` | e410ee80 (da697908) |
| M9 | 'changes' | draft | `changes_asked.who` from the `posting_changes_requested` actor (portal means client) | the f0d2ff1f post (client, 28 Sep 08:58); e2d47057 (time past, time cleared) |
| M10 | approved, no job | ready | `approval` from activity | |
| M11 | draft | draft (orphans are cancelled with "card deleted") | | 15 orphan drafts |

**Also:**
- **Orphans:** set `source_deleted` on all 46 orphan posts.
- **Unowned jobs:** attach the 16 unowned `publish_jobs` to their post via `resend_of` where possible (ff85fac3 gains 54f9c381 and fdb70988). Report the rest.
- **bc8ab921:** `approval.hat = super_admin` actor b9be2fe1. The migration looks the role up from `team_users`; nobody has checked it yet. `client_send` null, so the board stops saying "Sent to client".
- **054e0959:** a7a5f0de becomes posted on LinkedIn only. Its Instagram row c8fd52cf becomes `publish_status` null and `live_url` null, and the report lists "Instagram still owed".
- **schedule_entries:** rewrite `live_url`/`publish_status` per platform from `platform_results` for the 8 mismatched rows (664bc5e9, db43d45c, ade9808c, 8f3a9862, d6cd38f7, 93ebe5c9, 2f178d68, c8fd52cf). Set 48f70493's `scheduled_at` to the time of the published job 3d2e8537.
- **Edit side (L4):** back-fill `client_rounds:[1]` for b98b07a3, c836cf10, 370209f1, ee923633 and 4de414d6 from their `→ client_review` activity. Normalise 9169e122's `client_rounds` to `[2]`.
- **After `--write` and verification:** a second pass (`--drop-legacy`) removes `posting_approval_state`, `posting_client_required` and `client_sent` from `content_items`, and `status`, `sent_at`, `approval_mode`, `approved_*` and `publish_job_ids` from `social_posts`.
- **Before M7 and M8 posts go back to anyone:** they carry "Frozen at migration, not at send". The board shows "Resend to be sure the client sees this version", because what was emailed on 28 Sep cannot be reconstructed.

---

## 7. Build order: independent work packages

**P0 goes first and alone.** It fixes the contract the others build against. Then P1 to P7 run in parallel worktrees. P8 and P9 can be written in parallel and run last. Each package owns only the files listed. A file not listed is touched by nobody. If a package needs a change in a file it does not own, it asks the owning package.

| Pkg | Owns (create or edit) | Delivers | Depends |
|---|---|---|---|
| **P0 Core** | `app/lib/post-stage-core.ts` (new), `tests/post-stage-core.test.ts` (new), `scripts/gen-db-types.mjs`, `lib/db-types.ts` (regen), `app/lib/post-act-contract.ts` (new: request and response types, route path) | Stages, the transition table, guards, `postActions`, `waitingOn`, `slotMissed`, `laneOf`, `validateComposition` re-export; ghost fields and `post_versions`, `post_events`, `post_comments` | — |
| **P1 Server engine** | `app/lib/post-stage.ts` (new), `app/api/posts/[id]/act/route.ts` (new), `app/lib/social-schedule.ts`, `app/api/social/schedule/**`, `app/api/production/items/[id]/route.ts`, `…/send-to-client/route.ts` (reduced to a proxy for T2/T4, then deleted), `…/posting-approval/route.ts` (deleted), `app/lib/posting-approval.ts` and `posting-approval-core.ts` (deleted, with their tests), `middleware.ts` (gate `/api/posts`) | Claims, freeze, booking order, cancel without siblings, re-book, delete cascade, no draft emails | P0 |
| **P2 Publish recorder** | `app/lib/publish.ts`, `publish-core.ts`, `production-publish.ts`, `zernio-webhook.ts`, `post-analytics.ts`, `post-outcome-core.ts`, `app/inngest/functions.ts` (no new function, so no re-sync needed; if one is added, run the trap 5b `curl -X PUT`) | `recordPostOutcome` per network, T16/T17/T18, resend children linked, per-platform `schedule_entries` | P0 |
| **P3 Post window** | `app/dashboard/social/schedule/NewPostDialog.tsx` (renamed `PostWindow.tsx`), `TimePicker.tsx`, `MediaPicker.tsx`, `useComposeFlow.tsx`, `EditMediaLauncher.tsx`, `app/lib/schedule-compose-core.ts`, `app/dashboard/scheduler/SendForApprovalDialog.tsx` (deleted), `NewPostButton.tsx` | §4.1 | P0 (calls the P0 contract; mocks P1) |
| **P4 Schedule views** | `social/schedule/page.tsx`, `useSchedulePosts.ts`, `views.tsx`, `WeekGrid.tsx`, `tiles.tsx`, `MediaRail.tsx`, `app/lib/social-schedule-core.ts` (delete `mirrorStatus`/`postTileFacts` status logic), `posted-slides-core.ts`, `schedule-drag-core.ts` | §4.3 | P0 |
| **P5 Post approval board** | `app/dashboard/scheduler/page.tsx`, `WaitingOnYou.tsx`, `app/dashboard/scheduler/board/*` (new post board), `app/lib/post-board-core.ts` (new), `post-waiting-core.ts` (new), `board-view-core.ts` (remove `postingColumn`, the scheduler page branch and the posting parts of `clientHadIt`), `waiting-core.ts` (remove the posting branch), `post-to-client-core.ts` (deleted), `PostApprovalDetail.tsx`/`CardSheet.tsx` (the posting path removed) | §4.2 | P0 |
| **P6 Portal** | `app/portal/[token]/**`, `app/api/portal/act/route.ts`, `app/lib/portal-thread.ts`, `portal-data.ts`, `portal-core.ts`, `portal-post.ts`, and the portal components (`PortalBoard`, `ApprovePanel`, `PostReview`, `PortalPostApproval`, `PortalSectionsView`) | §4.4 including the edit freeze read | P0 |
| **P7 Edit freeze and notify** | `app/lib/workflow.ts` (write `client_frozen` at `→client_review`), `app/lib/post-notify.ts` (new: every posting email, sent after the fact it reports), `booked-notify.ts` | §2.6, emails | P0 |
| **P8 Migration** | `scripts/migrate-post-stage.mjs`, `tests/migrate-post-stage.test.ts` (fixture = a scrubbed snapshot of the rows cited in §6) | §6 | P0; `--write` only after P1 and P2 are merged |
| **P9 E2E** | `playwright.config.ts`, `e2e/**`, `package.json` (script `e2e`), `.env.e2e.example` | §8.4 | P0; runs against everything merged |

**Merge order:** P0, then P1 and P2, then P3 to P7 in any order, then P8 dry-run, then P9 green, then deploy, then P8 `--write`, then verify, then P8 `--drop-legacy`.

**Cutover:** deploy and migration go in one window. The old readers are gone in the same deploy, so there is no dual running.

---

## 8. Test plan

### 8.1 Unit (vitest, all packages)

- **`post-stage-core`:** every T row for every hat, plus every wrong hat, wrong stage, stale version, missed slot, missing unchecked confirm, and Instagram with 11 slides (refused) against LinkedIn with 11 per-network slides (allowed).
- **`postActions` snapshot:** for each stage × role there is at least one forward action. This is a test named `no-dead-ends`.
- `waitingOn` and `slotMissed` with an injected `now`.
- `laneOf === stage`.

### 8.2 Server (vitest with an in-memory `lib/db` fake)

- **Race:** client T6 and manager T5 at the same time. Exactly one wins, and the other gets 409 with the fresh post (fixes V4).
- **Booking:** a `queuePublishJob` throw leaves the post in `ready` with `problem`, and no email is sent (fixes V14, V15).
- **Cancel isolation:** cancelling post A leaves sibling B's stage and job untouched (fixes V2).
- **Second post on the same item:** it can be sent, approved and booked after the first posted (fixes V1).
- **Edit after with_client:** gives v2 in draft. The portal still serves v1 until a resend, and `approve_post` with version 1 is refused after T19 (fixes V6, V7, P2).
- **Partial job:** the post becomes posted with a `problem`, T21 creates a new post limited to the failed networks, and `schedule_entries` gets the right URL on each platform (fixes L1, L2).
- **Delete:** item delete with a booked post is refused; with drafts, it cancels them and marks them `source_deleted` (fixes V8).

### 8.3 Source pins (the same style as `tests/drive-page-writes.test.ts`)

- No file outside `scripts/migrate-post-stage.mjs` mentions `posting_approval_state`, `posting_client_required` or `client_sent`.
- No file mentions `social_posts` `.status`.
- The only writer of `social_posts.stage` is `app/lib/post-stage.ts`.
- `NewPostDialog`/`PostWindow` has no `reviewOnly`. The focus effect's deps do not include `dirty` (fixes W1).

### 8.4 Playwright (P9), run before any push

- **Target:** ZZ E2E Test Client `d59d3fb2-c775-4782-b966-d61700a5de93`. Its channels are **test accounts only** (memory: use test accounts for posting experiments). Clerk testing tokens come from the `clerk-testing` skill. The portal is opened by its share token.
- **Every spec creates its own posts and cancels or deletes them in `afterEach`.** Never touch another client's rows.

| Journey | Checks |
|---|---|
| J1 Schedule upload through to Posted | Upload → draft → Send for quality check → the reviewer passes (T3) → Ready → Post now → Posted with every network's link. The lane matches the tile stage and the window chip at each step |
| J2 Via the client | Draft → Send to client (unchecked confirm appears; choose Send anyway) → the portal shows v1 → the team edits the caption → the portal still shows v1, then after the team action shows "being updated" → resend v2 → the client approves → Ready, with the card reading "Approved by the client" |
| J3 Manager on behalf | with_client → Approve for the client, with a note → the card and portal read "Approved by <manager> for you" |
| J4 Missed slot | Set a time 16 minutes out, send to the client, fake the clock past it (`page.clock`) → the portal buttons are gone and the board shows "Needs a new time" → New time and resend → the client can approve |
| J5 Cancel and Re-book | Book → Cancel → the tile leaves the grid and appears under Cancelled → Re-book → draft with the same media and caption and no time |
| J6 Caption focus | Type 40 characters without clicking again; the value equals the typed string |
| J7 Carousel | 11 images: Instagram refuses with a counter, LinkedIn with per-network slides allows 11 |
| J8 Portal safety | The client POSTs `approve_post` for a post in quality_check and gets 409. `?preview=1` shows nothing extra |
| J9 Drag | Drag a with_client card onto Ready gives a refusal toast with the reason, and the card does not move |

**Push gate:** `npm test`, `npx tsc --noEmit`, `npm run build` and `npm run e2e` must all pass.

---

## 9. Traceability: every confirmed finding and where it is fixed

**Board**

| ID | Finding | Fixed by |
|---|---|---|
| B1 | Lane from post approval, actions from edit status | §3 `laneOf`, §4.2 drag/move/toast from `postActions` |
| B2 | Booked in without post approval | T11 guard `approval.version` |
| B3 | Handed card stuck in Draft | §4.2 source tray; edit cards are not on the board |
| B4 | "Sent to client" never sent | `client_send` per version; delivered_at line removed |
| B5 | Drawer "Ready to post" chip | §4.1 header from stage |
| B6 | "Client asked" when a manager asked | `changes_asked.who` |
| B7 | Approve primary while with the client | §4.1 table: "Approve for the client" is secondary with a note |
| B8 | Changes missing from Waiting | `post-waiting-core` `waitingOn` |
| B9 | Toast names the wrong column | Toast from `result.stage` |
| B10 | List Column vs Stage | One Stage column |
| B11 | Draft card with no reason | `waitingOn.line` on every card |
| B12 | Overview counts | Tiles count `stage` |
| B13 | Booked posts awaiting approval | T19b: editing a booked post goes to draft |
| B14 | "since" resets | `stage_at` |
| B15 | Delete on booked | T23 only |
| B16 | Emailed button stale | `client_send.version` |

**Schedule views**

| ID | Finding | Fixed by |
|---|---|---|
| S1 | Delete draft cancels | T23 hard delete; cancelled off the grid |
| S2 | Post shows the item's state | `mirrorStatus` deleted; `stage` |
| S3 | Stories empty | `per_channel.kind` |
| S4 | Owner memo | deps fixed |
| S5 | duplicate job not live | `outcomes` treats duplicate as published |
| S6 | Rail treats failed files as used | "used" by stage |
| S7 | Partial reads "Did not go out" | T17, "Posted on 3 of 4" |
| S8 | Preview includes wrong posts | Filter |
| S9 | Orphans vanish | `source_deleted` shown |
| S10 | Edit media hits the wrong post | Launcher picks the opened or draft post |
| S11 | Remove unreachable | Reachable on all rail cards |
| S12 | Waiting words frozen | Clock tick |
| S13 | Lost channel hidden | Chip plus List text; T11 `channelsLive` |
| S14 | One logo | All logos |
| S15 | Posted plus "scheduled" | Per-network `outcomes` |

**Post window**

| ID | Finding | Fixed by |
|---|---|---|
| W1 | Focus loss | Effect deps; J6 |
| W2 | Cancelled dead end | T22; no-dead-ends test |
| W3 | No Post now | T12 and the Now chip; TOO_SOON text |
| W4 | "Booked in" lie | §3.1: the window reads the returned stage |
| W5 | "Waiting on you" while with the client | `waitingOn` |
| W6 | reviewOnly dead | Deleted |
| W7 | Picker shows old errors | Cleared |
| W8 | Errors hidden behind confirm | Layout |
| W9 | Minute box | TimePicker |
| W10 | Dead sendToClient | Deleted; T2 |

**Server state**

| ID | Finding | Fixed by |
|---|---|---|
| V1 | One gate per item | Stage per post |
| V2 | Cancel wipes siblings | T20 isolation |
| V3 | No re-book | T22 |
| V4 | Check-then-write | Claim with `rev` |
| V5 | Portal approves an unsent post | T6 guard |
| V6 | Nothing frozen | `post_versions` |
| V7 | New media un-sends | T19 |
| V8 | Delete leaves booking | Cascade |
| V9 | client_sent never cleared | `client_send` cleared |
| V10 | Stored status stale | `status` deleted |
| V11 | Resends unlinked | `booking.job_ids` |
| V12 | Draft emails | Removed |
| V13 | Tied to edit approval | §1.3, §5 |
| V14 | Email before booking | §3.1 |
| V15 | Scheduled with no job | §3.1 |
| V16 | One part marks all rows | Per-platform recorder |
| V17 | Board overwrite | Gone |
| V18 | Item changed before claim | Single claim |
| V19 | approval_mode | Dropped |
| V20 | cancelPost raw write | No item write |

**Portal**

| ID | Finding | Fixed by |
|---|---|---|
| P1 | Edit files not frozen | §2.6 |
| P2 | Post read live | Frozen version |
| P3 | Client approves internal | T6 guard |
| P4 | preview ungated | Removed |
| P5 | Published says "Approved, will book" | State table |
| P6 | Link shows the client's approval | `approval.hat` |
| P7 | Hero | Rendered only |
| P8 | Payload | Trimmed |
| P9 | Waiting before emailed | `client_send` only after delivery |
| P10 | Edit notes on slides | `post_comments` |
| P11 | Frames from a different post | Route by `postId` |
| P12 | Column disagrees | From stage |
| P13 | "Thanks for your note" | `changes_asked.who` |

**Live data**

| ID | Finding | Fixed by |
|---|---|---|
| L1 | Wrong network link | Recorder and M-rules |
| L2 | Unposted network marked published | Recorder; c8fd52cf fix |
| L3 | Status stays scheduled | `stage`; M2 |
| L4 | "Passed" at With client | Back-fill; line removed from post cards |
| L5 | Edit card on Post approval | Source tray |
| L6 | Orphan records | Cascade and M11 |
| L7 | approval_mode | Dropped |
| L8 | Stale scheduled_at | Recorder; 48f70493 fix |

**Where the verdicts corrected the findings.** These corrections are applied in §6 and do not change any fix:
- 8 mismatched link rows, not 9.
- Of the 13 orphan 'scheduled' rows, 9 have published jobs, 2 failed and 2 cancelled.
- There are 46 orphan social_posts, not 44.
- BoardList lines are at :26 and :60-61.
- postingColumn is at :759-770.

## 10. Open for the owner (decisions made here, reversible)

1. Is a time-only change after approval allowed without re-approval, with an FYI email to the client (T13/T15)?
2. Schedule uploads keep an `adhoc_post` card as the file holder for now (§2.5). Should a later package remove it?
3. What should the two posts migrated as with_client (2a74c976, e7f0e7a3) do? The proposal is to resend them as v1 so the client sees a frozen version. What was emailed on 28 Sep cannot be reconstructed.