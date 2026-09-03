# Social Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/dashboard/social/schedule`, a Later-style post calendar with a guided New-post flow that only ever posts client-approved graphics after final post approval.

**Architecture:** A new `social_posts` table holds a post before it is queued; the post's approval is the item's existing `posting_approval_state` driven through `actOnPostingApproval`; on approval the post is queued through the existing `queuePublishJob` (one job per channel). Pure rules live in `app/lib/social-schedule-core.ts`; the page renders from live `useTable` listeners; drag-and-drop uses native events with a keyboard alternative. The composer reuses `publish-core.ts` validation and per-channel kinds. The approval lock is enforced server-side on every publish path.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Tailwind v3 + the restyle components (`app/dashboard/ui/*`), `react-day-picker`, Firebase Realtime Database via `lib/db.ts` / `lib/db-client.ts`, Zernio via `app/lib/publisher.ts`, vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-social-schedule-design.md`

## Global Constraints

- Only items with `status ∈ {approved_for_scheduling, scheduled}` can start a post; only files from an approved version are publishable; Drive files and uploads become a new version that needs client approval first.
- `publishBlockReason(item)` is enforced in `queuePublishJob` and `/api/social/publish`; nothing bypasses final post approval.
- One post ↔ one item; the post's approval state is the item's `posting_approval_state` (never a parallel state machine).
- Never check-then-write: claims and rescheduling use `table().claim()` / `compareAndSet()` (CLAUDE.md trap 11).
- All new tables are ghost tables in `scripts/gen-db-types.mjs` (`social_posts`, `schedule_notes`); regenerate `lib/db-types.ts`; never write outside `/mdm`.
- Tests never publish to a real channel: `PUBLISH_DRY_RUN=1` makes `publisher.createPost` return a fake id (added in Task 2); the live harness uses only the ZZ TEST client and `.invalid` people with `EMAIL_TEST_ONLY=1`, and cleans up.
- Restyle tokens/components only (Tailwind v3, `.dbx`, dark mode, 44px controls, plain words; `tests/plain-words.test.ts` guards copy). Mobile: the rail becomes a bottom sheet, the grid becomes the list view.
- Definition of done per task: `npm test`, `npx tsc --noEmit`, `npm run build` green; screenshots at 1440 and 390, light and dark, for UI tasks.
- Commit trailers:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FCQZcAEnczFkyHa5KkcKm9
  ```

---

## File map

| File | Responsibility |
|---|---|
| `scripts/gen-db-types.mjs`, `lib/db-types.ts` | ghost tables `social_posts`, `schedule_notes` |
| `app/lib/social-schedule-core.ts` | pure: eligibility, tile tone, week/month grid maths, reschedule rules, suggested times, per-channel slide limits, post status mirror |
| `app/lib/social-schedule.ts` | server: create/update/reschedule/send/approve-then-queue, the publish lock, cancel-and-requeue |
| `app/api/social/schedule/route.ts` (+ `[id]/route.ts`, `[id]/send/route.ts`, `[id]/reschedule/route.ts`, `notes/route.ts`, `suggested/route.ts`) | routes |
| `app/api/social/publish/route.ts`, `app/lib/publish.ts` | the approval lock |
| `app/dashboard/social/schedule/page.tsx` + `components/` (`MediaRail`, `ProfilesBar`, `WeekGrid`, `MonthGrid`, `ListView`, `PreviewGrid`, `StoriesStrip`, `PostTile`, `NoteTile`, `NewPostDialog`, `MediaPicker`, `ImageEditor`, `TimePicker`, `useSchedulePosts.ts`, `useDragSchedule.ts`) | the page |
| `app/dashboard/social/schedule/access/page.tsx` | social set + people with access |
| `app/dashboard/ui/Shell.tsx` | nav entry "Schedule" first under Social |
| `tests/social-schedule-core.test.ts`, `tests/social-schedule-routes.test.ts`, `tests/e2e/social-schedule-live.e2e.ts` | tests |

---

### Task 1: Data model and pure core
- [ ] Ghost tables in the generator (`social_posts`, `schedule_notes` with the columns from the spec); regenerate; `tests/db-types.test.ts` gains a check for both.
- [ ] `social-schedule-core.ts`: `eligibility(item, versions)`, `tileTone(post, job?)`, `weekGrid(range, tz)` (6–20h, 44px rows, tile top from time), `monthCells`, `canReschedule(post)`, `mirrorStatus(item, post, jobs)`, `suggestedTimes(analytics, network, tz)` (90-day weekday×hour engagement, defaults per network when < 20 posts), `slideLimits(platforms)`, `groupForList`. Tests for each with the edge cases (DST week, empty analytics, a post at 20:00, a `changes` post cannot be scheduled).
- [ ] Commit `feat(schedule): data model and pure rules`.

### Task 2: Server flow and the approval lock
- [ ] `PUBLISH_DRY_RUN=1` in `publisher.ts` (fake ids, no network) — used only by tests.
- [ ] `social-schedule.ts`: `createPost` (from item + chosen slides + caption + channels + time; validates with `validatePost` per channel), `updatePost` (reverts approval via `stateAfterPostEdit` when content changed), `sendForApproval` (→ `actOnPostingApproval('send')`, status `pending`), `onApprovalChanged(item)` (mirror: `approved`/`changes`), `schedulePost` (requires approved + `MAY_PUBLISH`; `queuePublishJob` per channel with `scheduledFor`; writes `publish_job_ids`; claim-based), `reschedule` (rules from core; cancel + requeue for `scheduled`), `cancel`.
- [ ] Lock: `queuePublishJob` and `/api/social/publish` return the existing 409 text when `publishBlockReason` is non-null. Test on `seedDb`: an ad-hoc publish for a `pending` item is refused.
- [ ] Routes under `app/api/social/schedule/**` with role gates from the spec; route tests on `seedDb` for create → send → approve (through the existing item posting-approval route) → schedule (dry run) → reschedule → cancel; two-claimant test on schedule.
- [ ] Commit `feat(schedule): planned posts, approval lock, queue on approval`.

### Task 3: The page — rail, profiles bar, week grid (read-only first)
- [ ] `useSchedulePosts(clientId, range)`: `useTable` on `social_posts`, `publish_jobs`, `content_items`, `asset_versions`, `social_accounts` (by client), `schedule_notes`; derived tiles via core.
- [ ] `MediaRail` (approved graphics, filters Unused/Videos/Photos/Starred, greyed ineligible with reason, "Waiting for approval · N"), `ProfilesBar` (client picker, avatars with network badge that filter channels, "+" → access page, Stories/Preview/Week/Month/List), date bar, `WeekGrid` with `PostTile`, `NoteTile`, suggested-time slots, now-line, `StoriesStrip`.
- [ ] Nav entry; role gate; screenshots; commit `feat(schedule): calendar page, read-only`.

### Task 4: New post window, media picker, time picker
- [ ] `NewPostDialog` (720px): header selectors, best-times chips, graphic + slide strip + Change graphics, caption, post type per channel, More options (only what `publisher.ts` supports), footer approval pill + "Send for approval" split button (Save as draft); after approval: Schedule / Post now for `MAY_PUBLISH`.
- [ ] `MediaPicker` two-pane (Approved / Google Drive / Upload; drag across; reorder; per-channel limits; new-version rule with the plain notice). `TimePicker` (react-day-picker + h:m:AM/PM).
- [ ] Wire: rail "New post", empty-slot click, suggested-slot click, tile click (edit). Live check: approving on the item page updates the tile in another tab.
- [ ] Commit `feat(schedule): new post flow with media picker`.

### Task 5: Drag and drop, month/list/preview, notes
- [ ] `useDragSchedule`: rail → grid (opens New post with item + time), tile → slot (reschedule via API; snap back with a plain message on failure), keyboard (select + arrows + Enter), touch long-press. Month and List views; Preview grid; notes (create/edit/delete on a slot).
- [ ] Commit `feat(schedule): drag to plan, month, list, preview, notes`.

### Task 6: Image editor and access page
- [ ] `ImageEditor`: crop presets (canvas), filters, one text line; save as derived file; crop keeps approval, filters/text → new version needing approval (button says so). Video: trim + cover frame.
- [ ] `access/page.tsx`: social set (connect flow, health, refresh/edit/remove/reconnect) + people with access (from `team_user_clients`, plain-words rights, "Change" → existing manager assignment).
- [ ] Commit `feat(schedule): image editor and social set access page`.

### Task 7: Live harness, docs, final review
- [ ] `tests/e2e/social-schedule-live.e2e.ts` on ZZ TEST with `EMAIL_TEST_ONLY=1 PUBLISH_DRY_RUN=1`: create → send → approve as the test AM → schedule (dry) → reschedule → cancel; cleanup verified.
- [ ] `docs/PROJECT_STATE.md` section; CLAUDE.md layout line. Whole-branch review; merge menu.

### Task 8: Google Drive root picker and client-folder matching
- [ ] Settings → Integrations → Google Drive: "Choose folder" (Google Picker, `drive.file` grant for the picked folder) → stores `root_folder_id` + name; shows the picked folder's name and owner.
- [ ] `app/lib/gdrive-core.ts` (pure): `matchClientFolders(clients, subfolders)` → matched / unmatched / to-create with a name-normalisation rule (case, punctuation, "Pty Ltd"); tests.
- [ ] Review step in the UI: "matched N of M, K will be created", per-row override (pick a folder or create); apply writes `drive_folder_id` on each client; no folder created until confirmed.
- [ ] `gdrive-hooks.ts`/`gdrive-mirror.ts` unchanged except reading the client's `drive_folder_id` first (it may already). Live check on the ZZ TEST client with a throwaway folder; cleanup.

### Task 9: Files page (Drive view in MD Media's look)
- [ ] `/dashboard/files` under General: left tree of the HQ root (folders only, lazy), breadcrumb, search, Type/People/Modified/Client filters, list/grid toggle, folders grid, files grid with previews (Drive thumbnails via the API, Stream poster for video), info panel (client/item/version when the file is one the app mirrored — join on `drive_files`), New folder, Upload (goes through the app's mirror so it is recorded), Move/Rename/Share (Drive API through the tech connection), "Open in Drive", Download.
- [ ] Server: `app/api/drive/**` routes wrapping `gdrive.ts` (list children, thumbnails, create folder, move, rename, share link, upload via resumable session), role-gated like the rest of the dashboard; every write recorded in `drive_files` so the mirror and the page agree.
- [ ] Tests: pure sort/filter/breadcrumb core; route tests with a stubbed Drive client; live smoke against a throwaway folder in the ZZ TEST client's folder, cleaned up.
