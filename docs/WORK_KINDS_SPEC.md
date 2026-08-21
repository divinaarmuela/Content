# Work Kinds + Open Assignment — Mini-Spec (team meeting output, 21 Aug 2026)

All load-bearing claims verified against source before ruling: items GET or-clause (route.ts:36-38) and the scheduler status gate ordering (line 41) — confirmed; the detail-page has the SAME scheduler gap in `production-access.ts` line 28 (status check throws before the ownership escape at line 35), so a scheduler-owner is blind on both list and detail; `notifyJobAssigned` (workflow.ts:116-151) is role-agnostic — confirmed; items POST/PATCH accept any uuid as owner_id — confirmed; `/api/team` non-super branch returns ALL active roles including clients (team/route.ts:30) — confirmed; the two client-side `['editor','super_admin']` filters (production/page.tsx:111, [id]/page.tsx:236) — confirmed; workflow-core.ts:38 `revision_required→revision_complete` is `['editor']` only — confirmed.

PRESSURE-TEST RULINGS

- Table over jsonb: ARCHITECT WINS. Items FK it, archive semantics, concurrent admin edits. Consistent with batches/clients precedent.
- No parallel task entity: CONFIRMED. Every kind rides the same status machine, notifications, comments, versions. One nullable column + one 6-row table.
- content_type untouched: CONFIRMED, and I CUT UX's `default_format` auto-defaulting. Silently changing content_type when a kind is picked is a daily-path trap — deliverable_lines and monthly quotas key on content_type; an AM picking "Copywriting" for a carousel would silently drop the item out of the carousel quota. Format stays a fully manual field. (Architect was right: "nothing needs it".)
- `uses_media` KEPT (UX). One boolean, hides raw-assets link + source-file upload for copy/strategy. Cheap, removes real confusion.
- `color` KEPT but as a constrained slug pick-list validated in core, not free hex.
- /api/team server-side client filter: OVERRULED (UX). That route is deliberately a directory including client users. The security boundary is the item write; filter clients in the picker map, enforce at POST/PATCH owner_id validation.
- Scheduler transitions: NOT widened in v1. Schedulers become assignable, but the submit edges stay editor/AM (+super override). An AM submits on a scheduler-owner's behalf. Logged as known limitation.
- CUT from v1: announce-hint on kind CRUD, reorder chevrons (keep sort_order column, no UI), per-kind icons, kind-colored columns, second board grouping, drag reorder.

---

# FINAL MINI-SPEC — Work Kinds + Open Assignment (v1, build order)

## 1. SQL — `supabase/work_kinds.sql` (idempotent, run by hand in SQL editor)

```sql
-- Work kinds: the craft/discipline of an item (edit, graphics, copy…).
-- Orthogonal to content_type, which is the deliverable FORMAT and stays
-- wired to agreements/quotas/publishing untouched.
create table if not exists work_kinds (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  slug          text not null unique,
  name          text not null,
  default_roles text[] not null default '{editor}',  -- suggested-assignee roles
  uses_media    boolean not null default true,       -- show raw-assets fields in forms
  color         text not null default 'zinc',        -- pick-list slug, validated in core
  active        boolean not null default true,
  sort_order    int not null default 0
);

insert into work_kinds (slug, name, default_roles, uses_media, color, sort_order) values
  ('edit',     'Video edit',  '{editor}',                      true,  'zinc',   0),
  ('graphics', 'Graphics',    '{editor}',                      true,  'pink',   1),
  ('copy',     'Copywriting', '{account_manager}',             false, 'sky',    2),
  ('strategy', 'Strategy',    '{account_manager,super_admin}', false, 'indigo', 3),
  ('other',    'Other',       '{editor}',                      true,  'zinc',   4)
on conflict (slug) do nothing;

alter table content_items add column if not exists
  work_kind_id uuid references work_kinds(id) on delete set null;
update content_items set work_kind_id = (select id from work_kinds where slug = 'edit')
  where work_kind_id is null;
create index if not exists content_items_kind_idx on content_items (work_kind_id);

alter table work_kinds enable row level security;  -- deny-by-default; service role only
```

Rules: kinds are archived (`active=false`), never deleted. Server default for item POSTs omitting the field = the `edit` kind's id.

## 2. Pure core + tests — `app/lib/work-kinds-core.ts`, `work-kinds-core.test.ts` (workflow-core idiom: no I/O)

```ts
export const KIND_COLORS = ['zinc','pink','sky','indigo','violet','emerald','amber','rose'] as const
export const ASSIGNABLE_ROLES = ['scheduler','editor','account_manager','super_admin'] as const // never 'client'

validateKindInput({slug,name,default_roles,color,uses_media})
// slug /^[a-z0-9_-]{1,40}$/; name 1–80 trimmed; default_roles ⊆ ASSIGNABLE_ROLES;
// color ∈ KIND_COLORS. Returns {ok:true,value} | {ok:false,errors:string[]}

orderAssignees(kind: {default_roles:string[]} | null, members: {id,name,email,role}[])
// → {suggested: Member[], rest: Member[]} — suggested = role ∈ default_roles, name-sorted;
// rest grouped by role in ['editor','account_manager','super_admin','scheduler'] order,
// name-sorted within; a member appears exactly once. null kind → all in rest.

resolveKindForWrite(kinds: Kind[], requestedId: string | null | undefined)
// undefined/null → the 'edit' kind's id (fallback: first active by sort_order; null if none).
// requestedId → {ok:true,id} if exists AND active; {ok:false,reason} otherwise.
// PATCH variant flag allowInactiveUnchanged not needed: PATCH validates only when changing.

isValidOwner(member: {role:string, active_status?:boolean} | null)
// → member != null && active_status !== false && role !== 'client'
```

Tests: slug/color/role rejection incl. 'client'; ordering determinism + no-duplicate; resolve default/inactive/unknown; owner rejects client + inactive + missing.

## 3. API changes

**NEW `app/api/production/work-kinds/route.ts`**
- GET: `requireSignedIn()`; reject `user.role === 'client'` with 403. Returns all kinds ordered by `sort_order, name` including inactive (board must label archived kinds on old items); client passes `?active=1` for pickers.
- POST: `requireRole('account_manager')`. Body → `validateKindInput`; insert; unique-violation on slug → 409 `{error:'A work type with that name already exists'}`.

**NEW `app/api/production/work-kinds/[id]/route.ts`**
- PATCH: `requireRole('account_manager')`. Allowed: `name, default_roles, uses_media, color, active, sort_order` (slug immutable after create). Validate via core. No DELETE handler.

**`app/api/production/items/route.ts`**
- GET line 24: select → `'*, clients(name), batches(title), work_kinds(name, slug, color)'`. Accept `work_kind_id` filter param (uuid) alongside status/client/batch.
- GET line 41 (scheduler gate): `q = q.or(\`status.in.(${SCHEDULER_STATUSES.join(',')}),owner_id.eq.${user.id}\`)` — a scheduler sees their own pre-approval jobs.
- POST: fetch active kinds once per request. Per item: `resolveKindForWrite(kinds, it.work_kind_id)` → 400 on `!ok`; set `work_kind_id`. Validate `it.owner_id` when present: single query `team_users` where ids in collected owner_ids; each must pass `isValidOwner` → 400 `'owner_id must be an active team member'` otherwise.
- POST line 86 stays (`owner_id: it.owner_id ?? (user.role === 'editor' ? user.id : null)`).

**`app/api/production/items/[id]/route.ts`**
- PATCH line 81: add `'work_kind_id'` to `allowed`. If `work_kind_id` in patch and non-null: must exist AND be active (400 otherwise); null allowed (clears).
- PATCH: if `owner_id` in patch and non-null: look up team_users row, `isValidOwner` → 400 otherwise. (`assigned_by` logic at line 86 unchanged; `notifyJobAssigned` at line 100 unchanged — verified role-agnostic.)
- Cosmetic in workflow.ts:142: email body `(${item.content_type})` → append kind name when the item row carries it — SKIP if it needs an extra query; do only if kind name is already on the item object passed in.

**`app/lib/production-access.ts` line 28** — add owner escape hatch:
```ts
if (user.role === 'scheduler' && !SCHEDULER_STATUSES.includes(item.status) && item.owner_id !== user.id) throw …
```

**`app/lib/workflow-core.ts` line 38** — `revision_required→revision_complete` roles → `['editor','account_manager']`. (draft_uploaded→internal_review already has AM — verified line 30.) Update workflow-core tests: AM may mark revision complete; scheduler still may not.

## 4. UI changes per file

Terminology everywhere: **"Work type"** = kind; rename the existing content_type label **"Type" → "Format"** in the same PR (new-item dialog + item page) or the two selects read as duplicates.

**`app/dashboard/production/page.tsx`**
- Fetch `/api/production/work-kinds?active=1` alongside `/api/team`.
- Line 111: drop role filter → `.filter(m => m.role !== 'client' && m.active_status !== false)`.
- Dialog rows: Work type | Format, then Priority | Due date, then How many? | Assign to. Work type select: dot swatch (`h-2 w-2 rounded-full bg-{color}-…` via a static color→class map — no dynamic Tailwind class names, they purge) + name; always has a value (default = edit kind). AM+ only: SelectSeparator + "＋ Manage work types…" item that closes dialog and `router.push('/dashboard/settings/work-types')`.
- When selected kind `uses_media === false`: hide "Raw assets link" + "Source files" rows. Brief always visible; helper → "(what the work should be — sent to the assignee)".
- Label line 419 "Assign editor" → "Assign to". Populate via `orderAssignees(selectedKind, members)`: SelectGroup "Suggested" first (role hint suffix `· account manager` at 60% opacity), then role groups "Editors / Account managers / Super admins / Schedulers" (micro-label idiom `font-mono text-[10px] uppercase tracking-wider text-zinc-400`). Kind change while dialog open never clears a chosen owner.
- POST body: include `work_kind_id`.
- Card meta row: prepend kind chip (dot + mono `text-[11px] uppercase text-zinc-500` label) ONLY when kind is not 'edit' — deviations get ink, 90% of cards stay clean. content_type rendering unchanged.
- Filter: one `w-40` Select next to the client filter — "All work" + each kind with its dot; passes `work_kind_id` to the GET.

**`app/dashboard/production/[id]/page.tsx`**
- Line 236: same widen → all active non-client members; feed owner Select (473-485) AND comment-task assignee (856-862) with the grouped ordering (kind known from detail).
- Labels: placeholder 481 "Assign editor" → "Assign to"; item 484 "No editor assigned" → "Unassigned"; toasts line 426 → "Assigned to {name}" / "Owner cleared". Vital-signs label "Editor" → "Owner" (~556 area).
- Vital-signs strip: insert "WORK" chip (dot + kind name) before "Due".
- AM+ header: small kind Select next to owner Select (same size variant), PATCH `{work_kind_id}`, toast "Work type updated".
- Job pack card (line 643): raw-assets rows hide when kind `uses_media === false`; brief stays.

**NEW `app/dashboard/settings/work-types/page.tsx`** + tab entry in settings layout, gated AM+ (reuse existing role-gate idiom at AM level)
- Single Card, one row per kind: dot swatch, name (inline Input), default_roles badges, uses_media Switch ("Show raw-assets link and source-file upload when creating this kind of work."), color swatch radio row (the 8 KIND_COLORS), Archive/Restore.
- Header sub: "Work types classify what kind of job an item is — video edit, graphics, copy. They set who's suggested for assignment and which fields the item form shows. Format (reel, carousel…) is separate and tied to client agreements."
- Archive AlertDialog (no type-to-confirm): "Archive '{name}'?" / "Existing items keep it; it just stops appearing when creating new items. You can restore it here any time." / "Keep it" · "Archive".
- "Add work type" outline Button appends editable row (slug auto-derived from name, editable until save). Duplicate → toast "A work type with that name already exists."

Definition of done: `npm test` (existing 58 + new core/workflow tests), `npx tsc --noEmit`, `npm run build` all pass.

## 5. Explicitly OUT of v1
- Reorder UI (sort_order column exists; edit via SQL if desperate). Announce-hints/realtime on kind CRUD. Icons per kind. default_format / any content_type auto-defaulting. Kind-based board grouping or column tinting. Scheduler on submit-transition edges (schedulers are assignable; an AM submits their work — revisit if it bites). Kind name in assignment email if it costs an extra query. Any change to agreements/deliverable counting — stays keyed on content_type only. No changes to `/api/team` response shape.

## 6. Decisions log
1. Table over settings-jsonb — items FK it + archive semantics (Architect upheld).
2. Cut UX's `default_format`/auto-defaulting — silent content_type writes endanger agreement quotas.
3. Kept UX's `uses_media` + `color` (constrained pick-list) — cheap, daily-path value; colors validated in core, static class map in UI.
4. Overruled UX's "filter clients server-side in /api/team" — that route is a directory that includes clients by design; enforcement moved to owner_id validation at item POST/PATCH (the real boundary, which was open to ANY uuid — closed).
5. Extended Architect's scheduler fix to the detail page — production-access.ts:28 throws before its own ownership check; both list and detail get the owner escape.
6. workflow-core: only `revision_required→revision_complete` gains `account_manager`; draft edge already had it; schedulers deliberately not added (logged limitation).
7. Kind chip suppressed on 'edit' cards (UX upheld) — only deviations get ink.
8. Slug immutable after create — renames touch `name` only, so referencing rows and analytics never rot.
