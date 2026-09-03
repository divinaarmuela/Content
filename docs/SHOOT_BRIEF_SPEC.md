# Shoot Brief + Client Agreements — Build Spec (design-team output, 20 Aug 2026)

BUILD SPEC — Deliverables Agreement + Shoot Brief (MD Media Agency OS)
Reconciled final. Verified: `uploadMedia` accepts any `purpose` string (defaults 'general') so `{purpose:'production'}` is valid; `item_status` enum contains `approved_for_scheduling`, `scheduled`, `published`.

DECISIONS LOG (one line each)
- D1: A brief IS a batch — extend `batches`, no separate table (ARCH+UX agreed; adopted).
- D2: Stored lifecycle `brief|locked|shot|wrapped`; "in production" is derived display state (UX over ARCH; critic #1).
- D3: Lock = editor+; unlock/date-change = AM+ with reason (UX over ARCH; critic #3/#4).
- D4: Items require batch in locked/shot; AM+ ad-hoc escape with mandatory reason for batchless (critic #2). Keep new `batch.client_id === item.client_id` check (ARCH; hole verified real).
- D5: Counting month = batch month/year → due_date month → created_at month (UX over ARCH; critic #5). Delivered = status in (approved_for_scheduling, scheduled, published).
- D6: Agreement shape = ARCH's `deliverable_lines [{type,label,monthly_qty}]`, max one line per content_type (critic #6); "Graphics" = relabeled `static`, no enum change.
- D7: `monthly_commitments` kept as per-month override; ADD `video_quota` column (critic #7).
- D8: Legacy batches backfilled to `'shot'` (critic #8).
- D9: Lock is always the team's act; shoot_proposals is an optional informational confirmation child — NO auto-lock on client accept (UX over ARCH; critic #9).
- D10: Discussion/batch comments CUT from v1 (critic #10).
- D11: Names: route `/dashboard/production/shoots/[id]`; endpoint `/api/production/deliverables-progress`; jsonb column `reference_media`; upload purpose `'production'` (critic #11).
- D12: Client tab registered as GRANTABLE_PAGES href entry, not "ALL_TABS key"; schedulers/editors don't get the tab by default — API GET stays scheduler+ (critic #12).
- D13: Gate wording is editor+ (schedulers can't create anything); hide "Plan shoot" CTA for schedulers (critic #13).

=====================================================================
STEP 1 — no SQL step: tables are created on first write (Firebase Realtime Database — this plan predates the move off Supabase; it was originally supabase/agreements_and_briefs.sql, now docs/schema-history/agreements_and_briefs.sql)
=====================================================================
```sql
-- A) client_agreements: the standing deal (one row per client)
create table if not exists client_agreements (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  client_id uuid not null references clients(id) on delete cascade unique,
  -- [{ "type":"static", "label":"Graphics", "monthly_qty":20 }] — type ∈ content_type set, max one line per type
  deliverable_lines jsonb not null default '[]'::jsonb,
  -- [{ "key":"manychat", "label":"ManyChat automation", "note":"", "active":true }] — custom keys "custom:<slug>"
  services jsonb not null default '[]'::jsonb,
  notes text,
  updated_by uuid references team_users(id) on delete set null
);
alter table client_agreements enable row level security;
drop trigger if exists client_agreements_updated_at on client_agreements;
create trigger client_agreements_updated_at before update on client_agreements
  for each row execute function set_updated_at();

-- B) batches → shoot briefs. ORDER MATTERS: add column, backfill, THEN default+not null.
alter table batches add column if not exists status text;
update batches set status = 'shot' where status is null;   -- legacy: chip-visible, item-attachable, out of planning sections
alter table batches alter column status set default 'brief';
alter table batches alter column status set not null;
do $$ begin
  alter table batches add constraint batches_status_check
    check (status in ('brief','locked','shot','wrapped'));
exception when duplicate_object then null; end $$;
alter table batches add column if not exists concept text;
alter table batches add column if not exists location text;
alter table batches add column if not exists shot_list jsonb not null default '[]'::jsonb;            -- [{id,text,type?,qty?,done}]
alter table batches add column if not exists planned_deliverables jsonb not null default '[]'::jsonb; -- [{type,qty}]
alter table batches add column if not exists reference_media jsonb not null default '[]'::jsonb;      -- [{kind:'image'|'link',url,name?,note?}]
alter table batches add column if not exists locked_at timestamptz;
alter table batches add column if not exists locked_by uuid references team_users(id) on delete set null;
alter table batches add column if not exists shot_at timestamptz;
alter table batches add column if not exists proposal_id uuid references shoot_proposals(id) on delete set null;
create index if not exists batches_status_idx on batches (status);

-- C) proposal back-link (informational only — no auto-lock)
alter table shoot_proposals add column if not exists batch_id uuid references batches(id) on delete set null;

-- D) monthly_commitments: video was missing an override column
alter table monthly_commitments add column if not exists video_quota int not null default 0;
```

=====================================================================
STEP 2 — PURE CORE MODULES + TESTS (write tests first; vitest, no I/O)
=====================================================================
NEW `app/lib/batch-brief-core.ts` (mirror workflow-core.ts style; imports only Role):
- `BATCH_STATUSES = ['brief','locked','shot','wrapped']`, `BatchStatus`.
- `BATCH_TRANSITIONS`:
  - `brief→locked` roles ['editor','account_manager'], requires shoot_date, label 'Lock shoot date'
  - `locked→brief` roles ['account_manager'], label 'Unlock'
  - `locked→shot` roles ['editor','account_manager'], label 'Mark as shot'
  - `locked→wrapped` + `shot→wrapped` roles ['account_manager'], label 'Wrap shoot'
  - super_admin overrides all (same as checkTransition).
- `checkBatchTransition(role, from, to)`, `availableBatchTransitions(role, from)`.
- `batchSatisfiesLock(b)`: valid shoot_date present (and title non-empty).
- `canCreateItemsUnder(batchStatus: BatchStatus|null, role, adhoc?: {reason: string})`: true when status locked/shot and role editor+; true when batchStatus null ONLY IF role AM+ AND adhoc.reason non-empty trimmed; super_admin still needs the reason for null batch (auditability); everything else false. Full role×status×adhoc matrix tested.
- `isInProduction(b, itemCount)`: (locked||shot) && itemCount>0 — display helper.
- `BATCH_TRANSITION_NOTIFICATIONS`: 'brief>locked'→['owner_editor','account_managers'], 'locked>shot'→['account_managers'].

NEW `app/lib/agreement-core.ts`:
- `TYPE_LABELS = { static:'Graphics', reel:'Reels', carousel:'Carousels', story:'Stories', video:'Video', other:'Other' }` — the ONE label map shared by agreement, brief, board.
- `RETAINED_SERVICE_CATALOG`: [{key,label}] — manychat 'ManyChat automation', edm 'EDM / email marketing', content_production 'Content production', creator_seeding 'Creator seeding', paid_social_strategy 'Paid social strategy', weekly_reporting 'Weekly reporting', quarterly_brand_strategy_review 'Quarterly brand & strategy review'. Custom entries key `custom:<slug>`.
- `normaliseDeliverableLines(raw)`: type ∈ content_type set, label defaults from TYPE_LABELS, monthly_qty int ≥0, REJECT duplicate types; returns {lines}|{error}.
- `normaliseServices(raw)`: known key or custom:, label non-empty, active bool, note string.
- `effectiveQuotas(lines, commitmentRow|null)`: commitments columns (reel/carousel/story/static/video/other_quota) override matching-type lines when a row exists; returns [{type,label,quota}]. Tested: row-no-agreement, agreement-no-row, partial.
- `monthOfItem(item, batch|null)`: batch?.month/year first → due_date month → created_at month. Tested: null batch, null due_date, year boundary.
- `computeMonthlyProgress(items, batchesById, month, year, quotas)`: [{type,label,quota,planned,delivered}] — planned = all items in month, delivered = status ∈ DELIVERED_STATUSES = ('approved_for_scheduling','scheduled','published'). Tested: bucketing, zero-quota lines hidden flag, overshoot.

NEW tests: `tests/batch-brief-core.test.ts`, `tests/agreement-core.test.ts`. Existing 58 tests + tsc + build must stay green (see Step 5 for fixture changes).

=====================================================================
STEP 3 — API ROUTES (all authz server-side; accessibleClientIds scoping wherever client_id is read; logActivity on every mutation; announceBatchChange on every batch mutation)
=====================================================================
`app/lib/production-live.ts`: add `announceBatchChange({batch_id, client_id, status, kind:'created'|'updated'|'transition'|'deleted'})`, fire-and-forget on the existing production channel (useProductionLive already blanket-reloads).

- NEW `GET /api/clients/[id]/agreement` — scheduler+ (requireRole('scheduler')), client-scope check via accessibleClientIds. Returns `{agreement: row|null, catalog: RETAINED_SERVICE_CATALOG}`.
- NEW `PUT /api/clients/[id]/agreement` — AM+. Body `{deliverable_lines, services, notes}`; run normalisers (422 on error); upsert onConflict client_id; set updated_by; logActivity('client_agreement','updated').
- NEW `GET /api/production/deliverables-progress?client_id&month&year` — requireSignedIn, scoped exactly like GET /items (client role → own clients only). Loads agreement + commitments row (effectiveQuotas) + content_items (id,batch_id,content_type,status,due_date,created_at) + their batches' month/year; returns `{per_type: [{type,label,quota,planned,delivered}]}` via computeMonthlyProgress. Powers client Overview card, board strip, brief captions.
- CHANGED `POST /api/production/batches` — editor+ (unchanged role). Inserts status 'brief'; accepts client_id, title (required), description, concept, location, shoot_date (optional now), shot_list, planned_deliverables, reference_media; owner_id=user; logActivity + announceBatchChange.
- CHANGED `GET /api/production/batches` — include the new columns + status; unchanged scoping.
- NEW `GET /api/production/batches/[id]` — scheduler+ scoped; batch + clients(name) + content_items(id,title,status) (for the Production rail card).
- NEW `PATCH /api/production/batches/[id]` — editor+ scoped. Field-level patches ONLY (client sends just the changed field — jsonb clobber mitigation, critic #16): title, description, concept, location, shot_list, planned_deliverables, reference_media, owner_id (AM+ only), and shoot_date ONLY while status='brief'. Never writes status. AM+ action `{action:'change_date', shoot_date, reason}` allowed when locked/shot: requires non-empty reason, updates shoot_date AND re-derives month/year, logActivity with old→new+reason. announceBatchChange.
- NEW `POST /api/production/batches/[id]/transition` — body `{to, expected_status}`. checkBatchTransition(role, expected_status, to); brief→locked additionally requires batchSatisfiesLock (422 'Set a shoot date first'). Optimistic concurrency: `update ... set status=to, locked_at/locked_by (on lock) or shot_at (on shot) where id=? and status=expected_status`; zero rows → 409 'Someone else moved this brief — refresh.' On lock: derive month/year from shoot_date. On unlock (locked→brief): clear locked_at/locked_by, keep month/year. logActivity + announceBatchChange + notification fan-out per BATCH_TRANSITION_NOTIFICATIONS.
- NEW `DELETE /api/production/batches/[id]` — AM+ (critic #14). Refuse (409) unless status='brief' AND zero content_items. logActivity + announceBatchChange(kind:'deleted').
- OPTIONAL NEW `POST /api/production/batches/[id]/propose` — AM+, only when status='locked'. Creates shoot_proposals row (batch_id set, starts_at from shoot_date), stores proposal_id on batch. The existing accept handler does NOT touch batch status (D9) — accept only flips the pill via proposal status.
- CHANGED `POST /api/production/items` — THE GATE, server-side. Accept optional top-level `{adhoc_reason?: string}`. After per-item client-access check: if batch_id present, fetch batch, verify `batch.client_id === item.client_id` (403 if not — closes existing hole) and `canCreateItemsUnder(batch.status, role)`; if batch_id absent, require `canCreateItemsUnder(null, role, {reason: adhoc_reason})`. Failure → 422 body message EXACTLY: `Content items need a locked shoot. Lock the shoot date on its brief first.` Ad-hoc creations log the reason to workflow_activity. Existing batchless items grandfathered (no backfill). Everything else (bulk 1–50, sanitiseRawAssets, notifyJobAssigned, announceItemChange) unchanged.
- CHANGED `POST /api/production/commitments` — accept `video_quota`.

=====================================================================
STEP 4 — PAGES / COMPONENTS
=====================================================================
Registration: PAGE_TITLES entries "Shoots" (/dashboard/production/shoots), "Shoot brief" (…/shoots/[id]), "Agreement" (/dashboard/clients/[id]/agreement). page-access-core: shoots routes ride production page access (item-detail-style exception for /shoots/[id]); add GRANTABLE_PAGES entry `{ href: '/dashboard/clients/:id/agreement', label: 'Agreement', parent: '/dashboard/clients' }` + tab in clients/[id]/layout.tsx (visible per canSeeSubpage; edit controls gated useRole().can('account_manager')).

4a. SHOOT LIST `/dashboard/production/shoots` ('use client'; load batches+clients in Promise.all; useProductionLive reload; needsSchema fallback card text references **supabase/agreements_and_briefs.sql**):
- Top row: two-pill view switcher [ Board ] [ Shoots ] (batch-chip idiom, selected inverted; also added to the board page, board default) + client Select + search Input.
- Sections by mono header (`font-mono text-[11px] uppercase tracking-widest text-zinc-400`): IN PLANNING (brief), DATE LOCKED (locked), SHOT, WRAPPED (collapsed by default). Cards = kanban idiom (py-0 Card, p-3, hover:shadow-md, in Link): row1 title + status Badge (brief=amber, locked=sky, shot=violet, wrapped=zinc — STATUS_STYLE-style map w/ dark variants); row2 client · shoot date or italic zinc-400 `No date yet`; row3 mono tabular-nums `4 shots planned · 12 deliverables · 3 items in production` (nonzero segments only).
- `Plan shoot` primary button (HIDDEN for schedulers — POST is editor+): opens Dialog `New shoot brief` (sm:max-w-md): `Client` select + `Working title` input (placeholder "e.g. September studio day"); `Create brief`/`Creating…`; on success navigate to /shoots/[id].
- Empty state: dashed Card, `No shoots planned` / `Plan a shoot to brief the team before production starts.` / `Plan shoot` button (editor+).

4b. BRIEF PAGE `/dashboard/production/shoots/[id]` — working surface, all patch-on-blur (each blur PATCHes ONLY its field), toasts on failure only, no Save button. Known limitation comment in code: concurrent shot_list edits are last-write-wins; realtime reload keeps the window small.
- Header: inline-editable title (text-2xl, click-to-edit, blur-save); client avatar-chip (links to client page) · status Badge · owner chip. Right: lifecycle primary button + overflow menu (Wrap shoot AM+, Delete AM+ AlertDialog — only enabled status brief & 0 items).
- Body: left working column (~2/3, min-w-0) + right sticky rail 320–360px; stacks under lg.
- LEFT: (1) CONCEPT & NOTES — borderless autosizing textarea, placeholder `What's the idea? Moodboard notes, talent, wardrobe, props, hooks…`. (2) SHOT LIST — rows: checkbox ("captured", meaningful once shot) + description input + optional type Select (labels from TYPE_LABELS) + optional qty; hover ✕; `+ Add shot` ghost; empty text `No shots yet. List what needs to be captured on the day.`; when status=shot header shows mono `5/8 captured`. Add-order only, no drag (v1). (3) REFERENCES — CSS-columns grid of image tiles (uploadMedia(file,{purpose:'production'}), dropzone + file picker, hover ✕) and link cards (URL input → domain card + note); `+ Image` / `+ Link`; stored `reference_media`; empty: dashed dropzone `Drop reference images or add links.` NO Discussion section (v1 cut).
- RIGHT RAIL: (1) SHOOT DETAILS — Shoot date picker (while brief) / locked display after lock: lock icon + `Fri 12 Sep 2026` + mono `LOCKED BY A. AKMAL · 21 AUG` + `Change date` link (AM+ only → AlertDialog `Change a locked date?` with required reason input; on save auto-comment-free, just logActivity); Location input (placeholder `Studio, address, or "TBC"`); Owner select (AM+); derived Month/Year as mono text. (2) PLANNED DELIVERABLES — rows type Select + qty stepper + ✕, `+ Add deliverable`; under each row a mono caption from GET deliverables-progress for the shoot's month: `Covers 8 of 20 Graphics · 8 remaining after this shoot`; amber when overshooting: `Exceeds monthly agreement by 2` (informational, never blocks); no agreement → zinc-400 `No agreement on file` (AM+ sees it as link to the agreement tab). (3) LIFECYCLE — big status Badge + vertical mini-timeline Brief→Locked→Shot→In production, completed steps stamped mono `LOCKED · 12 SEP · A. AKMAL`; primary action from availableBatchTransitions. (4) PRODUCTION — before lock: disabled zinc-400 `Lock the shoot date to start creating content items.`; after: item count, up to 5 mini rows (title + status badge), `View on board` (board pre-filtered to this chip), `+ Create items` opening the existing item dialog with client+batch preselected and locked.
- LOCK CEREMONY: primary `Lock shoot date` (disabled + tooltip `Set a shoot date first` until date set). AlertDialog: title `Lock this shoot date?`; date huge (text-3xl font-semibold) + client/location line; copy `Locking commits the team to this date and opens the shoot for content items. Changing a locked date requires an account manager.`; optional AM+-only checkbox (when client has portal contact) `Send date to client for confirmation` → fires /propose after lock succeeds; buttons Cancel / `Lock date` (`Locking…`). Success toast: `Shoot locked for 12 Sep. Content items are now open.` Proposal pill on brief: amber `Client confirmation pending` → green `Client confirmed`. `Mark as shot` becomes primary once locked && shoot_date ≤ today (also in overflow earlier); no confirmation dialog.

4c. AGREEMENT TAB `/dashboard/clients/[id]/agreement`:
- Section 1 MONTHLY DELIVERABLES (Card): compact table, one row per type (Graphics, Reels, Carousels, Stories, Video, Other — TYPE_LABELS), qty stepper each (0 hides from progress surfaces); mono caption `Default quantities per month. Individual months can be adjusted from the production board.` Edit AM+ (patch-on-blur → PUT), read-only otherwise.
- Section 2 RETAINED SERVICES (Card): catalog checklist rows (checkbox + label + optional note input) + `+ Custom service` (label + note). Active rows render as outline Badges on view surfaces.
- Section 3 NOTES: textarea patch-on-blur, placeholder `Commercial notes, term dates, anything the team should know.`
- Empty state (no row): dashed Card `No agreement on file`; AM+ sub `Record the client's monthly deliverables and retained services so the team can plan against them.` + `Set up agreement` button (creates row via PUT, reveals form); non-AM sub `An account manager hasn't recorded this client's agreement yet.`, no button.
- `Adjust this month` link on progress surfaces (AM+) → Dialog sm:max-w-md, steppers pre-filled from EFFECTIVE values, mono caption `Overrides the agreement for September 2026 only. Future agreement changes won't apply to this month.` (critic #17) — writes monthly_commitments via existing POST (now incl. video_quota).

=====================================================================
STEP 5 — INTEGRATION CHANGES TO EXISTING SURFACES
=====================================================================
- `app/dashboard/production/page.tsx`:
  - Add [ Board | Shoots ] pill switcher.
  - REMOVE "New batch (shoot)" dialog; replace button with `Plan shoot` → New shoot brief dialog (as 4a; hidden for schedulers).
  - Batch chip row: status dot before title (locked=sky, shot=violet); `brief` batches never chip; `wrapped` batches: chip hidden only when ALL its items are published, otherwise shown dimmed (critic #15).
  - Item dialog: batch Select lists ONLY locked/shot batches, grouped `Locked shoots` / `Shot`, options `title · 12 Sep`; "No batch" option removed for non-AM; AM+ gets `Ad-hoc item (no shoot)` toggle revealing a required reason input (sent as adhoc_reason); relabel static option `Graphic / static`. Surface the 422 gate message verbatim in the dialog error.
  - When board is filtered to one client (client filter or batch chip): slim progress strip between chip row and columns — mono tabular-nums pills `Graphics 12/20 · Reels 5/8` (over-quota pill amber), tooltip `9 published · 3 in production · 8 remaining in September`, `Adjust this month` link AM+. No client selected → no strip.
- `app/dashboard/clients/[id]/page.tsx` (Overview): "This month" Card under ManagersCard — per active type: label, `12 / 20` tabular-nums, thin progress bar (zinc; amber when over); footer Badge wrap-row of active services; empty `No agreement on file.` + AM+ `Set up agreement →` link.
- `app/dashboard/clients/[id]/layout.tsx`: Agreement tab.
- `app/dashboard/layout.tsx`: PAGE_TITLES entries.
- Tests/E2E fixtures: any fixture creating batchless items must first create a batch and transition it to locked (or pass AM adhoc_reason); item-dialog tests updated for removed "No batch". All 58 existing tests + new core tests + tsc + build green before ship.
- `app/lib/production-live.ts`: announceBatchChange (Step 3).

=====================================================================
STEP 6 — EXPLICITLY OUT OF V1
=====================================================================
- Brief Discussion thread (item_comments.batch_id migration) — fast-follow with `check (item_id is not null or batch_id is not null)`.
- `effective_from` on client_agreements; Duplicate brief; shot-list drag-reorder (shape keeps `id` so it's cheap later); paste-to-upload on references; Overview-dashboard per-client progress table; folding standalone shoot_proposals entry into the lock flow (it remains standalone, plus the new optional child path); aggregate cross-client board strip.
- KEPT in v1 deliberately: shot-list captured checkbox (`5/8 captured`) and amber overshoot captions.

OWNER SIGN-OFF LIST: (1) items now require a locked shoot — AM-only ad-hoc override with logged reason; (2) date changes after lock are AM-gated + audited; (3) batch-month-first counting rule (Sep shoot delivering early-Oct items counts to September); (4) Graphics ≈ `static` labeling — confirm this matches how the agency counts; (5) real `video_quota` column added; (6) brief-stage batches invisible on the kanban until locked; (7) title+date-only batch creation no longer possible.

Key files (absolute): C:\Users\User\myProjects\content\Content\supabase\agreements_and_briefs.sql (new); app\lib\batch-brief-core.ts, app\lib\agreement-core.ts (new); app\lib\production-live.ts; app\api\production\batches\route.ts; app\api\production\batches\[id]\{route,transition,propose}\route.ts (new); app\api\production\items\route.ts; app\api\production\commitments\route.ts; app\api\production\deliverables-progress\route.ts (new); app\api\clients\[id]\agreement\route.ts (new); app\lib\page-access-core.ts; app\dashboard\layout.tsx; app\dashboard\production\page.tsx; app\dashboard\production\shoots\{page,[id]\page}.tsx (new); app\dashboard\clients\[id]\{layout.tsx,page.tsx,agreement\page.tsx}; tests\batch-brief-core.test.ts, tests\agreement-core.test.ts (new).
