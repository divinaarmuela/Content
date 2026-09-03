# Social → Schedule — design

**Date:** 3 September 2026
**Status:** approved by the owner from the mockup ("so good"): https://claude.ai/code/artifact/a952d413-f53e-473f-ba18-fbee823ccedc (page "Schedule")
**Depends on:** the dashboard restyle branch `dashboard-look` (shell, tokens, `app/dashboard/ui/*`); builds on the Firebase data layer.

## Goal

A new page under Social, **Schedule** (`/dashboard/social/schedule`), laid out like Later: a media rail of the client's approved graphics, the client's connected profiles along the top, an hourly week calendar with a thumbnail tile per post, a small "New post" window, and a "Social profiles" screen. The owner's flow, enforced end to end: **new post → choose an item the client has already approved → choose its real graphics → caption and channels → send for approval → once approved, it can post.** Posting is locked until approval, on every path.

The existing `/dashboard/scheduler` stays (it is the item-centric board); Schedule is the post-centric calendar.

## What exists and is reused (from the code map)

- Client approval of the asset: `content_items.status ∈ {approved_for_scheduling, scheduled}` (`workflow-core.ts`). Only those items are eligible.
- Real graphics: the item's latest `asset_versions` row → `slidesOf(version)` / `postSlides(contentType, slides)` (`version-files-core.ts`); thumbnails from the slide URLs (R2) or the Cloudflare Stream preview for video (`stream.ts`).
- Final post approval: `posting_approval_state` on the item (`null|draft|pending|approved|changes`), `actOnPostingApproval` (`posting-approval.ts`) with its notifications and portal actions; `publishBlockReason` (`posting-approval-core.ts`); who may send (scheduler/editor-owner/super admin) and who may approve (account manager/super admin/client).
- Composer rules: `publish-core.ts` (`PLATFORM_RULES`, `validatePost`, `postWarnings`), `media-fit-core.ts`, `shrink-core.ts`, per-channel `kind` resolution (`ComposeDialog.tsx`), `queuePublishJob`/`runPublishJob` (`publish.ts`), `publish_jobs` statuses, one-live-job-per-item claim.
- Channels: `social_accounts` per client, token health via `/api/social/accounts?health=1`, connect flow via `/api/social/connect`.
- Calendar helpers: `work-calendar-core.ts` (`eventsFor`), `formatInZone`/`toZonedInput` (`timezone-core.ts`).

## New: the planned post

A post must exist **before** it is queued to Zernio (it sits in approval first), so a new table holds the composition:

```
social_posts/<id>
  client_id, item_id, version_id, version_number
  slides: [{ url, name, type, bytes }]      // the chosen subset, in order
  caption, per_channel: { [accountId]: { caption?, kind?, slides? } }
  channels: [social_account_id...]
  scheduled_for (ISO), timezone
  status: 'draft' | 'pending' | 'approved' | 'changes' | 'scheduled' | 'published' | 'failed' | 'cancelled'
  publish_job_ids: [id...]                 // filled when queued
  created_by, created_at, updated_at, sent_at, approved_at, approved_by, note
```

Rules (pure, in `app/lib/social-schedule-core.ts`, tested):
- **Eligibility**: an item can start a post only if `status ∈ {approved_for_scheduling, scheduled}` and it has a version with at least one publishable slide. Others render greyed with the plain reason ("Still with the client", "Changes in progress", "No graphics yet").
- **Approval binding**: one post ↔ one item. The post's approval IS the item's `posting_approval_state`, driven through `actOnPostingApproval` so the account manager's item page, the client portal and every notification keep working unchanged. `social_posts.status` mirrors it (`pending`/`approved`/`changes`) and adds the publish lifecycle (`scheduled`/`published`/`failed`).
- **Skip approval (per post, owner decision 3 Sep)**: at send time the sender chooses "Send for approval" or "Schedule without approval". Only people who may approve posting (the client's account manager, super admin) can skip; schedulers and editors cannot. Skipping drives the same state machine (`send` then `approve` as the actor) so the item, portal and notifications stay consistent; `social_posts.approval_mode` is `self` or `client` and `approved_by` records who cleared it. Client approval of the graphics is never skipped.
- **Lock**: `queuePublishJob` and `/api/social/publish` refuse when `publishBlockReason(item)` is non-null (closes today's gap: the ad-hoc composer path bypasses approval).
- **Queueing**: on approve (or on schedule after approval) the post is queued through the existing `queuePublishJob` with `scheduledFor`, one job per channel, `linkItemId = item_id`, and the job ids are written back. The provider holds the schedule (as today).
- **Reschedule**: dragging a tile (or changing the time) is allowed while `status ∈ {draft, pending, approved, changes}` (just update `scheduled_for`) and while `scheduled` (cancel the provider job(s) via the existing cancel path, re-queue at the new time; if cancel fails, the tile snaps back with a plain message). `published`/`failed`/`cancelled` tiles do not move.
- **Editing after approval** reverts to `pending` (reuse `stateAfterPostEdit`).
- **Tile tone**: amber pending, red changes, green approved, blue scheduled, ink published, muted draft, red-outline failed.

## Page layout (from the mockup)

- **Media rail** (236px): "New post" pill; the selected client's approved graphics as 2-column thumbnails (one per eligible item, its first slide; video shows the Stream poster with a play mark); greyed tiles for ineligible items; drag a tile onto a day/hour to start a post with that item and time preselected; a bottom pill "Waiting for approval · N" that filters the calendar.
- **Profiles bar** (68px): client picker (the clients the viewer may see); the client's connected profiles as avatars with a network badge; a dashed "+" → Social profiles screen. View toggle: Week / Month / List (Preview deferred; no dead tab).
- **Date bar** (56px): Today, arrows, range label, the client's timezone name.
- **Week grid**: 6 AM to 8 PM by hour (44px rows), day columns, today shaded, a blue now-line, tiles positioned by time (80px tall: thumbnail, time badge, network badge, state dot). Click a tile → opens the post window in edit mode. Empty slot click → New post at that time.
- **Month view**: day cells with up to 3 small thumbnails and a "+N". **List view**: rows grouped by day (thumb, time, channels, state chip, item title).
- **New post window** (720px modal): header (profile selector with avatar, Auto publish, "on <date · time>", preview icon, close); left: the graphic 240px with slide count badge and "Client approved" badge, slide strip with "+N", "Change graphics" (opens the slide picker: tap to include/exclude, drag to reorder, per-channel limits from `PLATFORM_RULES`); right: caption, "More options" (first comment, location, collaborator, "Also post to <other connected channel>"); footer: delete, an amber "Needs approval before it can post" pill (green "Approved" once approved), and one primary split button: **Send for approval** (menu: Save as draft). After approval the primary becomes **Schedule** (or **Post now**) for people who may publish.
- **Social profiles** screen: back link, client header with "Add social profile" (existing connect flow), network row (connected in ink, available in outline), a table: profile, status (Connected / Needs reconnecting, expiry from token health), actions Refresh / Edit / Remove or Reconnect.

All in the restyle's tokens and components (`Shell`, `PageTitle`, `Chip`, pills). Mobile: rail collapses to a bottom sheet, grid becomes the list view.

## Roles

- See the page: everyone who may see Social today (`userMaySeePage`).
- Create/edit/send for approval: scheduler, account manager, super admin; editors may draft for their own items (matches `maySendPostApproval`).
- Approve/request changes: account manager, super admin, client via portal (unchanged).
- Schedule/post after approval: `MAY_PUBLISH` (scheduler, account manager, super admin).

## Realtime

The page renders from `useTable` listeners on `social_posts` (by client), `publish_jobs` (by client), `content_items` (by client), `asset_versions`, `social_accounts` (by client). Approvals made on the item page or the portal show on the calendar within a second.

## Out of scope (v1)

Best time to post; the Instagram grid Preview tab; hashtag suggestions; the media library as an upload target (graphics come from approved items only, by design).

## Testing

- Pure core tests (eligibility, tones, grid maths, reschedule rules, per-channel slide limits).
- Route tests on `seedDb` for create / edit / send / approve-then-queue / reschedule / the lock on `/api/social/publish`.
- Live harness on the ZZ TEST client with `EMAIL_TEST_ONLY=1`: create → send → approve (as test AM) → schedule with a zero-risk channel? No: never publish live in tests — stop at "approved + queued" with the provider call stubbed by an env flag (`PUBLISH_DRY_RUN=1`, added if absent), and clean up.
- Screenshots at 1440 and 390 in light and dark; two-tab live check for an approval.

## Drag and drop (as in Later)

Two drags, both visible in the mockup:
1. **Rail → calendar**: drag an approved graphic from the media rail and drop it on a day column at an hour; the drop target highlights (dashed blue column, "Drop · 2:00 PM" slot). Dropping opens the New post window with that item, its graphics and the time preselected. Dropping on a day in Month view picks the day and the client's default posting time.
2. **Tile → another day/time**: drag a post tile to reschedule. Allowed while `draft/pending/approved/changes` (update `scheduled_for`) and `scheduled` (cancel the provider job(s), re-queue at the new time). `published/failed/cancelled` tiles do not drag. While dragging the tile lifts (shadow, slight tilt) and the target slot shows the new time; on drop the tile snaps to the slot and the time badge updates live for every viewer.
Implementation: native HTML5 drag events with a keyboard alternative (select a tile, arrow keys move by 30 minutes / a day, Enter confirms), matching how `WorkCalendar` moves due dates today. Touch: long-press to lift.

## Social set and access (child page)

Route: `/dashboard/social/schedule/access` (reached from the "+" avatar and the client picker's "Manage" item; also linked from Settings → Integrations). Modelled on Later's "Social Sets & Access Groups", mapped onto what the app already has:
- **Social set** = the client's connected profiles, one per network at most (`social_accounts` for the client). Network row shows connected (ink) and available (outline); "Add social profile" runs the existing connect flow (`/api/social/connect`) and lands the new account in the set. Each row: profile, status from token health (Connected / Needs reconnecting / Disconnected, with expiry), actions Refresh (re-check health), Edit (display name, default posting time zone), Remove (deactivate, with a plain confirm; never deletes history), Reconnect when expired.
- **People with access** = the team members assigned to the client (`team_user_clients`) with what they may do on Schedule, derived from their role: account manager → approve and post; scheduler → create and send for approval, post after approval; editor → draft own items; super admin → everything. "Change" opens the existing manager-assignment action (`/api/clients/[id]/managers`) — no new permission model; the page explains the existing one in plain words.
- No "groups of groups": MD Media's clients ARE the access groups. The page title says the client's name; the copy never uses the words "social set" or "access group" except as the section labels the owner asked for.

## Everything else on Later's calendar (owner: "look at every part")

| Later element | Ours (v1 unless marked) |
|---|---|
| Pink "best time to post" slots with a clock, several per day | **Suggested times**: faint blue slots with a clock on the week grid. Computed per client from their own `post_analytics` (engagement by weekday × hour, last 90 days) once they have 20+ posts with analytics; before that, sensible defaults per network (Instagram 11:00/18:30, TikTok 12:00/19:00, LinkedIn 08:30/12:30, Facebook 12:00/18:00 in the client's zone). Clicking a slot starts a post at that time. Pure rules in `social-schedule-core.ts`; the "why" is one plain sentence on hover ("Your posts get the most reactions around 6 pm on weekdays"). |
| "Create Note" on a slot | **Notes** on any day/time: a short text card on the calendar (`schedule_notes`: client_id, at, text, created_by). Shown as a paper-tinted tile with a pin; visible to the team only. |
| Media rail: Upload Media, Dropbox, ⭐, "Get Content Ideas", **Show Filters**, filter chips (`unused ✕`, Clear All) | Rail: no upload here (graphics come from approved items — by design); **Filters** row: Unused / Used, Photos / Videos / Carousels, Starred, and the item's work kind as labels; "unused" = not yet used in any post. Star a graphic to pin it to the top. Clear all. Content ideas and hashtags: not in v1 (the AI assistant page is the place for that later). |
| "Stories" view | A **Stories strip** at the top of the week grid ("No stories scheduled" when empty), story posts shown there instead of in the hour grid. |
| "Preview" view | **Preview**: the client's Instagram grid — live posts and scheduled posts in order, so the feed can be checked before anything goes out. v1 keeps it simple: 3-column grid of thumbnails with a small state dot, scheduled ones slightly faded. |
| Week / Month / List | As specified. |
| Timezone label | The client's zone name, click to switch to the viewer's zone. |
| "Select Profiles" + avatar row with "+" | The profiles bar (connected profiles; "+" → the access page). Selecting avatars filters the calendar to those channels. |
| "Getting Started" checklist | A small Schedule checklist for a client with nothing set up yet: connect a profile → get an item approved → schedule the first post. Plain words, disappears when done. |
| "Invalid Attribute" style errors | Never. Every error is a plain sentence about what to do. |

## Media picker and image editor (from Later's "Add media" / "Change media" / "Edit image")

- **Add / Change media** is a two-pane window over the composer (the composer stays visible, dimmed): left = library, right = the post's media. Drag a file from the left into the right to add it; drag inside the right to reorder; drop on an existing slot to replace it. Per-channel limits shown in plain words ("Instagram carousel: up to 10").
- **Library sources** (tabs on the left): **Approved** (the item's approved version files, the default), **Google Drive** (the client's mirrored Drive folder, `gdrive-mirror.ts`; MD Media uses Drive, not Dropbox), **Upload** (drop files or pick from the computer; uploads go to R2 through the existing presign route and the upload queue). Faded tiles are already in the post.
- **Approval rule for new files**: anything that is not from an approved version (a Drive file or an upload) is attached to the item as a **new version** and marked "needs the client's approval"; the post cannot be sent for approval until that version is approved through the normal flow. This keeps "only approved graphics get posted" true without blocking the workflow.
- **Best times strip** in the composer header: three suggested times as chips (from the same rules as the calendar's suggested slots); clicking one sets the post time.
- **Edit image** (opens from a slot): **Crop** with platform presets (Freeform, Square 1:1, Instagram portrait 4:5, Story/Reel 9:16, Landscape 1.91:1) done in the browser on a canvas and saved as a derived file; **Filters** (brightness, contrast, saturation, warmth, a few named looks) and **Text** (one line, brand font, colour from the brand palette, position). Cropping keeps the approval (same picture, tighter frame). Filters and text produce a new picture → saved as a new version that needs the client's approval, stated plainly on the Update button ("Update image · needs client approval"). Video: trim start/end and cover-frame pick only (no filters/text in v1).

## Composer details from Later's post window

- **Time picker**: clicking the "on <date · time>" pill opens a dropdown calendar (month + year, arrows, today highlighted, next-month days faded) with an hour : minute : AM/PM row underneath; picking a best-time chip fills it. Built with the repo's `react-day-picker` (already a dependency) plus three small number inputs; the client's timezone shown under it.
- **Post type** selector beside the caption (Feed / Reel / Story / Carousel per channel, from `availableKinds(platform, media)`), exactly the per-channel kinds the composer already resolves.
- Under the image: **Edit image**, **Add alt text** (accessibility text sent with the post where the platform supports it), **Change media**.
- Caption helpers: emoji, saved captions (per client, a small list the team keeps), hashtag suggestions (v2, from the AI assistant).
- "Tag people", "Tag products" and "Link in bio" are platform features Zernio may or may not expose; shown only where the provider supports them for that channel (checked at build time against `publisher.ts`), never as dead rows.
- Footer note: "This post will be posted automatically at <time>" once approved and scheduled.
