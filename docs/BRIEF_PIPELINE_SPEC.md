# Shoot-Brief Pipeline Rework — Build List (team meeting, 21 Aug 2026)

PRESSURE-TEST VERDICTS (what changed from the drafts, with ground-truth corrections)

A. **The model is right and stands**: brief task = `content_items` row, kind `shoot_brief`, 1:1 auto-linked batch, item machine untouched, batch machine untouched, labels overlaid per kind. Rejecting batch review-statuses is correct.
B. **Cut the dual entry point.** The architect's "batches POST also inserts a companion item" changes behavior for every existing shoot-creation flow (shoots page line 105, asana normalizeBatch) and forces backfill questions. ONE creation path: items POST auto-creates the batch. The shoots page keeps creating plain batches (a batch without a brief-task card is legal — that's every legacy batch already). The partial unique index still guarantees ≤1 brief item per batch.
C. **Ground-truth correction — the terminology sweep is nearly empty.** The architect's cited strings do not exist: grep of `app/dashboard` shows NO user-facing "Batch" strings in production/page.tsx (no "Batches" chip caption at 311, no "New batch (shoot)" dialog at 584-609, no "Batch created" toast — the shoot dialog lives in `shoots/page.tsx` and already says Shoot; `shoot-ui.tsx` labels are already Shoot-worded). The only real gaps: notifications ICON map (page.tsx:35 handles `shoot_` but not `batch_` event types) and a grep of notification SUBJECT strings for "batch". Do not budget a sweep; budget those two.
D. **Ground-truth confirmation — scroll bug.** `components/ui/scroll-area.tsx:20` renders only the default vertical `<ScrollBar />`; Radix disables overflow-x without a horizontal scrollbar mounted. The board's `<ScrollArea className="w-full">` at production/page.tsx:344 clips ~1.9k px of columns. `ScrollBar` is ALREADY imported at line 18 — the fix is two lines at the call site.
E. **Reuse `brief` for the reviewer note** (architect) — the UX's `reviewer_note` column is cut. One new item column total: `brief_url`.
F. **Bell v1 is a badge, not a dropdown.** The UX dropdown (360px panel, 1s mark-read timers, per-row read) is v1.1. Yusuf asked for "bell + unread count"; the feed page exists. Bell icon-button in the header linking to /dashboard/notifications, red count badge, mark-ALL-read on page open, unread tint on rows. Idempotent, no races.
G. **Labels live in a NEW `brief-task-core.ts`**, not workflow-core (UX had them in workflow-core; keeping workflow-core byte-identical protects the 58 tests and the "nothing else decides what moves where" contract).
H. **Deliverables UI in the dialog = the shoot page's existing row pattern** (type select + qty + remove, `shoots/[id]/page.tsx:396-442`), not the chip-stepper system. Same sanitiser, same shape, less new UI.
I. **`published` is unreachable for briefs by design** — the override table simply defines no exit from `scheduled` for the kind; label it 'Shoot booked' defensively.
J. **Quota safety belt is the kind join, not content_type**: exclude `work_kinds.slug='shoot_brief'` in deliverables-progress and the scheduler queue regardless of the `'other'` content_type choice.

---

# THE FINAL BUILD LIST — execute top-down

## 1) SQL — new file `supabase/shoot_brief_tasks.sql` (idempotent, run by hand per repo convention)

```sql
-- 1. the kind, with a FIXED uuid so the index predicate below is a constant
insert into work_kinds (id, slug, name, default_roles, uses_media, color, sort_order)
values ('c0a80000-0000-4000-8000-000000000b21','shoot_brief','Shoot brief',
        array['account_manager'], false, 'sky', 5)
on conflict (slug) do nothing;

-- 2. at most ONE brief task per shoot — enforced structurally, never check-then-write
create unique index if not exists content_items_one_brief_per_batch_uidx
  on content_items (batch_id)
  where work_kind_id = 'c0a80000-0000-4000-8000-000000000b21' and batch_id is not null;

-- 3. the external brief link (Milanote or anywhere; optional per the owner)
alter table content_items add column if not exists brief_url text;

-- 4. notification read-state
alter table notification_log add column if not exists read_at timestamptz;
create index if not exists notification_log_unread_idx
  on notification_log (recipient_id) where read_at is null;
```

## 2) Pure cores + vitest (all 58 existing tests stay green; workflow-core.ts and batch-brief-core's existing exports byte-identical)

**NEW `app/lib/brief-task-core.ts`** (+ `brief-task-core.test.ts`):
- `export const SHOOT_BRIEF_SLUG = 'shoot_brief'`
- `BRIEF_KIND_LABELS: Record<ItemStatus,string>` = draft_uploaded:'Shoot brief', internal_review:'Internal review', revision_required:'Revisions requested', revision_complete:'Revisions done', client_review:'Client review', client_changes_requested:'Client changes', approved_for_scheduling:'Approved — book it', scheduled:'Shoot booked', published:'Shoot booked'.
- `itemStatusLabel(kindSlug, status, fallback)` → BRIEF_KIND_LABELS[status] when slug===SHOOT_BRIEF_SLUG else fallback.
- `BRIEF_TRANSITION_OVERRIDES` keyed `'from>to'`: `'draft_uploaded>internal_review'` → {label:'Submit brief for review', roles:['editor','account_manager']}; `'revision_required>revision_complete'` → {label:'Mark revisions done', roles:['editor','account_manager']}; `'approved_for_scheduling>scheduled'` → {roles:['account_manager'], label:'Mark shoot booked', requires:'batch_locked'}; `'scheduled>published'` → BLOCKED (terminal).
- `checkBriefTaskTransition(role, from, to)`: consult `TRANSITIONS` for existence, apply overrides (blocked edge → `{ok:false}` even for super_admin? No — super_admin may still force it, matching checkTransition semantics; simplest: blocked for everyone, tested), fall through to `checkTransition` unchanged otherwise.
- `briefSatisfiesSubmission(item:{brief_url?}, batch:{concept?, shot_list?})` → true when brief_url non-blank OR batch.concept non-blank OR shot_list non-empty; returns `{ok}|{ok:false, missing:'Add a brief link or fill in the brief page first'}`.
- Tests: label fallback for non-brief kinds; every override edge per role incl. super_admin; blocked publish edge; submission predicate truth table; non-overridden edges identical to `checkTransition` output.

**`app/lib/batch-brief-core.ts`** — extend `canCreateItemsUnder(batchStatus, role, adhoc?, kindSlug?)` (4th optional param, existing call sites unchanged): when `kindSlug==='shoot_brief'` → allowed for account_manager/super_admin when `batchStatus==='brief'` OR `batchStatus===null` (no adhoc reason needed — the item creates its own batch); all other kinds identical to today. Add tests.

## 3) API

**`app/api/production/items/route.ts`**
- GET (line 26): select adds `brief_url` and widens the batch join to `batches(title, status, planned_deliverables)`.
- POST: after `resolveKindForWrite`, look up the resolved kind's slug. When `shoot_brief`: force `count` to 1 per payload row; gate via `canCreateItemsUnder(batchStatus, role, undefined, 'shoot_brief')`; when `batch_id` absent, first `insert into batches (client_id, title, status:'brief', shoot_date?, planned_deliverables?)` (sanitise via `sanitisePlannedDeliverables`), then insert the item with that `batch_id`, `content_type:'other'`, `brief_url` (string, trimmed, ≤2000). Unique-index violation on the brief index → 409 "This shoot already has a brief task". Non-brief kinds: unchanged path, but accept/persist `brief_url` only for the brief kind (ignore otherwise).
- PATCH (item update route): allow owner/AM to update `brief_url`; reuse `brief` column edits as-is.

**`app/lib/workflow.ts` `performTransition`** (the ONLY workflow.ts change, lines 313-344 region): load the item's kind slug + batch (`work_kinds(slug)`, `batches(status, concept, shot_list)` — add to the item fetch or one extra query). When slug==='shoot_brief': replace `checkTransition` with `checkBriefTaskTransition`; `reviewable_asset` satisfied by `briefSatisfiesSubmission` (skip asset_versions query); `approved_for_scheduling>scheduled` requires batch status `locked` or `shot` → else 400 "Lock the shoot date on the brief page first — locking IS booking"; never reaches the `schedule_entry`/`live_url` branches. Everything else (optimistic concurrency, audit, notification fan-out, dedupe) untouched — the existing `TRANSITION_NOTIFICATIONS` edges fire as-is, which is what feeds the bell.

**`app/api/production/deliverables-progress`** + the scheduler queue query (wherever `SCHEDULER_STATUSES` filters items): add `.neq`/join-filter excluding `work_kinds.slug='shoot_brief'`. Belt over the `'other'` content_type braces.

**`app/api/team/notifications/route.ts`**: GET adds `read_at` to the select and returns `unread_count` (`count where recipient_id=me and read_at is null`); support `?count=1` returning only `{unread_count}` (fast path for the bell). NEW `app/api/team/notifications/read/route.ts`: POST → `update notification_log set read_at=now() where recipient_id=$me and read_at is null`; idempotent; returns `{marked:n}`.

## 4) UI

**`app/dashboard/production/page.tsx`**
- Dialog, kind-aware (the `uses_media` flag finally earns its keep — it's already in the `kinds` state, line 119):
  - `uses_media===false` (graphics/copy/strategy AND shoot_brief): hide Raw assets link + Source files upload. (Yusuf's item 2, generalized.)
  - slug==='shoot_brief' additionally: dialog title "New shoot brief"; hide Shoot select + ad-hoc reason, Type, How many?; Brief textarea relabeled "Note to reviewer", placeholder "What Divina should look at first…"; ADD "Brief link" input (mono text-xs, label hint "(Milanote or anywhere — optional; you can also build it on our brief page)"), "Deliverables *" rows reusing the shoots-page type+qty row pattern (hint "(what the shoot must produce)"; validation ≥1 row, toast "Add at least one deliverable — the brief is the promise of what gets made."), optional "Target shoot date"; "Assign to" label → "Account manager" (orderAssignees already suggests AMs first via default_roles). Footer "Create shoot brief", success toast "Shoot brief created — it starts in Shoot brief."
- Card: for slug==='shoot_brief' suppress the mono content_type text; render deliverable chips from joined `batches.planned_deliverables` ("10 reels · 4 carousels · 20 stories", truncate 3 + "+n"); `border-l-2 border-l-sky-400` accent; in the Scheduled column show Badge "Shoot booked". Status badge text everywhere via `itemStatusLabel`.
- Subtitle: "Every piece of work, from shoot brief to scheduling. Click a card for detail and actions."
- **Scroll fix (line 344)**: `<ScrollArea className="w-full whitespace-nowrap"><div className="flex w-max gap-3 pb-3">…columns…</div><ScrollBar orientation="horizontal" /></ScrollArea>` — `ScrollBar` is already imported. Grep other `<ScrollArea` usages with horizontal flex children and apply the same pattern.

**`app/dashboard/production/[id]/page.tsx`** — detail payload gains kind slug + batch join. When shoot_brief: header sub-line "· Shoot brief" + deliverable summary (never "Other"); "Editor" caption → "Account manager"; HIDE Job pack, Versions, Caption, Scheduling/publishing cards; ADD "The brief" card: primary button "Open our brief page" → `/dashboard/production/shoots/{batch_id}`; "Brief link" input (blur-save, focusVal guard idiom) + "Open brief ↗" outline button when set; "Note to reviewer" textarea (the `brief` column, blur-save, read-only pre-wrap for non-owners). Transition buttons via override labels; Submit disabled with tooltip "Add a brief link or fill in the brief page first" until `briefSatisfiesSubmission`; submit-dialog copy "Who should review this brief?". At `scheduled`: footer line "Shoot booked — when it's shot, mark it shot on the brief page and create the content items there." + "Go to shoot page" button. Comments card stays (it IS the revision loop).

**`app/dashboard/layout.tsx`** — small client `<NotificationBell />` in the header right cluster (between theme toggle and role pill): ghost icon Button, Bell, red badge (`min-w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-mono tabular-nums`, "9+" cap, hidden at 0), `aria-label="Notifications, {n} unread"`, links to /dashboard/notifications. Data: `GET /api/team/notifications?count=1` on mount + 60s interval + refresh on the existing `useProductionLive` hint (transitions generate notifications, so the hint is a free push signal).

**`app/dashboard/notifications/page.tsx`** — unread rows get a blue dot + font-medium; POST `/read` after the list loads (badge clears, dots persist until next visit — you see what was new); ICON map line 35: add `eventType.startsWith('batch_')` to the `shoot_` CalendarClock branch. Grep notification subject templates for the word "batch" and reword to "shoot" if any hit (only remaining Yusuf-item-4 work; production UI is already Shoot-worded — verified).

**`app/dashboard/social/inbox/page.tsx`** — header `ml-auto` cluster: primary `<Button size="sm">` CalendarClock "Schedule a post". Import `ComposeDialog` and render in-page with the same props `social/page.tsx` passes, presetting the inbox's selected account/client; if the import drags heavy deps, fall back to `router.push('/dashboard/social?compose=1&account={acct}')` with the host reading the param (same idiom as `new_for_batch`, production/page.tsx:180).

## 5) Gates
`npm test` (58 + new brief-task/batch-brief tests), `npx tsc --noEmit`, `npm run build` — all three before claiming done. Manual: create brief → submit (blocked until link/brief content) → internal review → client review → approve → "Mark shoot booked" blocked until shoot date locked on the brief page → booked; verify the item never appears in scheduler queue or deliverables-progress; verify board scrolls past Scheduled at 1280px; verify bell count increments on assignment and clears on opening the feed.

## 6) OUT of v1
Bell dropdown panel + per-row mark-read (v1.1); companion item on batches POST / brief items for existing batches (workaround: create a fresh brief task); brief-item batch PICKER (auto-create only); client-portal rendering of brief items (they carry CLIENT_LABELS like everything else — acceptable); Milanote link previews; multi-brief per shoot (index forbids it deliberately).

## 7) Decisions log
1. Brief task = item of kind `shoot_brief`, 1:1 batch via fixed-uuid partial unique index; batch gains no review states. 2. Single entry point: items POST auto-creates the batch; batches POST untouched. 3. One new item column (`brief_url`); reviewer note reuses `brief`; deliverables reuse `batches.planned_deliverables`. 4. `content_type='other'` + kind-slug exclusion in quota/scheduler queries. 5. Kind-aware labels/overrides in new `brief-task-core.ts`; `workflow-core.ts` byte-identical. 6. "Booking = locking": approved→scheduled for briefs requires batch locked/shot, AM role; `scheduled` is terminal ("Shoot booked"). 7. Bell = badge + existing feed + mark-all-read on open; dropdown deferred. 8. `uses_media=false` hides footage fields for ALL non-media kinds, not just briefs. 9. Scroll bug = missing horizontal ScrollBar at production/page.tsx:344 (component default is vertical-only — confirmed); fix at call site. 10. Terminology sweep collapsed to the notifications icon map + subject-string audit — production UI already says Shoot (architect's cited "Batch" strings don't exist on disk).
