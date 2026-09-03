# Brief Canvas — Build List (research meeting, 21 Aug 2026)

PM-CRITIC — VERDICT AND FINAL BUILD LIST

PRESSURE-TEST RESULTS (what changed and why)
- Architect's stack call stands: hand-rolled DOM canvas + @use-gesture/react. Every rejection checks out (tldraw watermark/commercial license, react-flow wrong semantics, konva wrong medium, dnd-kit scale-compensation gap + React-19 friction). No change.
- CONFLICT 1 — placement. Architect: board between Concept and shot list, References masonry kept, "add to board" copies. UX: board below the grid, References card removed, one-time seeded migration. UX wins. Two moodboard surfaces on one page is the over-engineering here: the team is leaving Milanote precisely to have ONE board, and keeping the masonry plus a copy-bridge creates a permanent "which one is true" question. Board goes full-width BELOW the two-column grid (700px is genuinely too cramped; putting it mid-page above the shot list pushes the operational list below a 60vh canvas — worse for on-set). References card UI is removed; `reference_media` column, sanitiser, and upload pipeline stay untouched in the DB and API.
- SEED FIX (bug in UX spec): seeded cards must have DETERMINISTIC ids derived from the source refs (`seed-<ref.id>` sliced to 40), laid out in reference_media array order. Two editors opening simultaneously and both persisting then merge cleanly by id server-side instead of duplicating the whole board. Seed stays in-memory until first user action; no write on view. This makes the migration safe under the accepted concurrency model.
- CONFLICT 2 — world bounds: ±50,000 vs ±20,000. Take ±20,000 (UX). Still ~80 screens wide at 100%; smaller clamp = saner fit-to-cards math and jsonb.
- CONFLICT 3 — nudge: take UX (Arrow = 10px, Shift+Arrow = 1px). Coarse-by-default matches a moodboard; 1px default is useless at 60% zoom.
- CONFLICT 4 — note text cap: 4000 (architect) not 2000. Notes hold shot-day braindumps; cost is nil.
- CUTS for the day-scale budget (moved out of v1, listed in §6): image caption editing (show file name/`name`, read-only), Duplicate button, per-note color picker beyond the 6 fixed swatches is already minimal — keep colors (they're one style map + 6 dots, cheap and core to Milanote feel). Keep paste-to-create (small, high value). Keep fullscreen, undo-delete toast, mobile Sheet — all cheap on top of machinery that must exist anyway.
- Kept and endorsed: server-side per-card merge via `canvas_op` (this is the one piece that makes last-write-wins per CARD instead of per BOARD — non-negotiable), realtime-reload deferral during drag/edit, transform-only positioning, ref-mutation during gestures with state commit on gesture end, edit-mode-disables-drag.
- Repo check: migration files are feature-named (`supabase/production.sql` etc.), not numbered — architect's `<next-number>_canvas_cards.sql` corrected below. `sanitiseReferenceMedia` idiom confirmed at app/lib/batch-brief-core.ts:131.

================ THE FINAL BUILD LIST ================

1) DEPENDENCY
- `npm i @use-gesture/react@^10.3.1` — the ONLY new package (MIT, ~7kb gz, headless, React-19 clean). Used solely for wheel/pinch/pan normalization on the viewport. Card dragging is raw pointer events + setPointerCapture (no library).

2) No SQL step: `batches.canvas_cards` is created on first write (Firebase Realtime Database — this plan predates the move off Supabase; the field was originally `supabase/canvas_board.sql`, now `docs/schema-history/canvas_board.sql`).

3) PURE CORE + TESTS — C:/Users/User/myProjects/content/Content/app/lib/batch-brief-core.ts (extend)
- Type: `CanvasCard = { id: string; kind: 'note'|'image'|'link'|'label'; x: number; y: number; w: number; z: number; text?: string; url?: string; name?: string; color?: 'paper'|'yellow'|'pink'|'blue'|'green'|'purple' }`. Height intrinsic, never stored. No resize in v1 (w fixed per kind: note 208, image 240, link 240, label auto→store 240).
- `sanitiseCanvasCards(raw: unknown): CanvasCard[]` — same idiom as sanitiseReferenceMedia (line 131): array-guard; id String slice 40, fallback random; kind whitelist else drop; x/y finite→round→clamp ±20000; w clamp 120–1200 default 240; z int clamp 0–1e6; text slice 4000 (note) / 120 (label); url required for image+link, must start `https://`, slice 2000, else drop card; name slice 200; color whitelist else undefined; dedupe by id keep-last; cap 200.
- `applyCanvasOp(current: unknown, op: { upsert?: unknown; remove?: unknown }): CanvasCard[]` — sanitise current, sanitise upserts, merge by id (upsert wins), drop ids in remove (strings, cap 200), re-cap. Pure, no I/O.
- `seedCardsFromReferences(refs: ReferenceMedia[]): CanvasCard[]` — deterministic: label card `{id:'seed-label', kind:'label', text:'REFERENCES', x:0, y:-48}` + refs in array order into a 3-col grid (240px cols, 16px gutters, image cards est-height 240 / link cards 64 for row packing), each id `('seed-'+ref.id).slice(0,40)`, image ref→image card, link ref→link card. Pure, exported, tested.
- Vitest (alongside existing batch-brief-core tests): sanitiser drops bad kind/url/coords, clamps, dedupes, caps; applyCanvasOp merges disjoint upserts, removes, upsert+remove same id (remove wins after merge — pick and test one order: apply upserts then removes); seed determinism (same input → same ids/positions twice).

4) API — C:/Users/User/myProjects/content/Content/app/api/production/batches/[id]/route.ts (PATCH branch)
- Accept body field `canvas_op: { upsert?: CanvasCard[], remove?: string[] }`. After the existing batch load: `patch.canvas_cards = applyCanvasOp(batch.canvas_cards, body.canvas_op)`. Existing requireRole('editor') covers authz; announceBatchChange fires as today.
- DOCUMENT in a route comment: per-card last-write-wins; small server-side read-modify-write window accepted for v1 (per-card granularity + realtime reload keep collisions rare; future fix is a jsonb-merge SQL function).
- Client cadence: one op per drag-end / edit-commit / create / delete / color change; arrow-nudges debounced 500ms trailing; NEVER per-pointermove. Seed persistence: the first user action includes `upsert: [...allSeededCards, changedCard]` in one op.

5) COMPONENTS / FILES
- C:/Users/User/myProjects/content/Content/app/dashboard/production/shoots/[id]/BriefCanvas.tsx — NEW. Owns camera {x,y,scale} in a ref mirrored straight onto the world div style during gestures (React state commit on gesture end); viewport div `overflow-hidden touch-action:none overscroll-behavior:contain h-[60vh] min-h-[420px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950` with radial-gradient dot grid (24px, scales with zoom); world div `transform: translate() scale(); transform-origin:0 0`, cards absolutely positioned children translated individually.
  - Gestures (@use-gesture useWheel/usePinch/useDrag with `target`+preventDefault): plain wheel/two-finger = pan; ctrl/cmd+wheel + pinch = zoom anchored at cursor (worldPt=(cursor−cam)/s; cam'=cursor−worldPt·s'), clamp 25–200%; empty-background drag pans; Space-drag and middle-drag pan; no marquee in v1.
  - Card drag: pointerdown on card, 4px threshold before drag starts (clicks/double-clicks survive), setPointerCapture, delta ÷ scale, style mutated in rAF, z bumped to max+1 on start, commit+PATCH on pointerup. `will-change:transform` only while that card drags.
  - Selection: single-select; click = select (ring-2 ring-blue-500), background click / Esc deselects. Mini toolbar 8px above selected card (ghost h-7 w-7): notes = 6 color dots + divider + Trash2; links = Open (ExternalLink) + Trash2; images/labels = Trash2.
  - Keyboard: cards focusable (tabIndex=0, aria-label by kind+text), Tab cycles creation order, focus=selected; Arrow 10px / Shift+Arrow 1px (debounced persist); Delete/Backspace deletes with toast "Card deleted" + Undo (5s, re-upserts kept card); Enter/F2 edits note/label; Esc: exit edit → deselect → exit fullscreen; N note, F fullscreen, 1 fit-to-cards, +/- zoom. All suppressed while any input/textarea focused.
  - Toolbar (floating pill top-left, `rounded-lg border bg-white dark:bg-zinc-900 shadow-sm p-1 flex flex-col gap-0.5`, ghost h-8 w-8, tooltips right): StickyNote "Note — N" / ImagePlus "Image — upload or drop" (multi picker) / Link2 "Link — paste anywhere works too" (pill swaps to h-8 w-64 input "https://…", Enter adds, Esc cancels, invalid→toast "Links need to start with https://") / Type "Label". Click drops card at viewport centre (offset if occupied), selects, note/label enter edit immediately.
  - Create fast-paths (editors): double-click empty canvas = note at that world point, enters edit; Ctrl/Cmd+V image blob → upload+image card at cursor, URL → link card, text → note; drag-files-over shows `ring-2 ring-blue-500/40` + "Drop to add", drop uploads at drop point.
  - Uploads: optimistic skeleton card (spinner, objectURL) at final position → `uploadMedia(file,{purpose:'production'})` → swap url → canvas_op upsert; failure removes placeholder + existing "Upload failed" toast.
  - Realtime: useProductionLive reload deferred while a drag/edit is in flight, applied on release; card being edited keeps local text until commit. Save failure: toast "Could not save the board" then reload (patch() contract).
  - Zoom pill bottom-right: Minus · mono text-[11px] tabular-nums % (click resets 100%) · Plus · divider · Scan "Fit to cards — 1". First mount with cards = fit-to-cards, 64px padding, cap 100%.
  - Fullscreen: F / Maximize2 → `fixed inset-0 z-50 bg-zinc-50 dark:bg-zinc-950` (inside .dbx), top bar shoot title + Minimize2 + "Esc to exit".
  - Seed: on mount, if sanitised canvas_cards empty AND reference_media non-empty → render `seedCardsFromReferences(refs)` in memory; persist whole set with first user op; no write on view.
- C:/Users/User/myProjects/content/Content/app/dashboard/production/shoots/[id]/CanvasCard.tsx — NEW, React.memo per card object ref. NOTE: 208px, p-3, text-[13px] leading-relaxed, color map paper/yellow(amber-100 · dark amber-950/60)/pink(rose)/blue(sky)/green(emerald)/purple(violet), text zinc-900/zinc-100, placeholder "Write it down…"; double-click swaps to auto-grown autofocused textarea, drag disabled while editing, blur/Esc commits. IMAGE: 240px, natural aspect, rounded-lg overflow-hidden border, `loading="lazy" decoding="async" draggable={false}`, caption line = name/filename, px-2 py-1 text-[11px] text-zinc-500 truncate, read-only in v1. LINK: 240px chip, Link2 h-4 w-4 text-zinc-400, title-over-hostname stack; click selects, open only via toolbar Open / Ctrl+click / mobile tap. LABEL: transparent, `font-mono text-sm uppercase tracking-widest text-zinc-400 dark:text-zinc-500`, text cap 120. Hover ring-1 zinc-300/700; drag scale-1.02 shadow-lg cursor-grabbing.
- C:/Users/User/myProjects/content/Content/app/dashboard/production/shoots/[id]/page.tsx — CHANGED: remove the References card UI (leave reference_media data + API alone); add full-width section BELOW the two-column grid: mono label "BOARD", right-aligned "{n} cards" (singular "1 card"), Maximize2 ghost button "Fullscreen — F"; extend local Batch type with `canvas_cards: CanvasCard[]`; pass cards, canEdit, and a sendOp callback wired to the existing patch() helper.
- Read-only + mobile (coarse pointer or <lg): pan/pinch/fit only, no toolbar, passive caption "View only on mobile" (text-[10px] mono top-right), h-[70vh] on small screens, opens fit-to-cards, double-tap zooms; tap card → shadcn Sheet: note = full text readable size; image = full-bleed + "Open full size"; link = title/host + "Open link". Desktop canEdit=false gets the same read-only canvas. Touch tablets = phone behaviour in v1 (stated).
- Empty states: editors — "Your board. Drop images, paste links, or double-click anywhere to write a note." + mono "N note · drag to pan · Ctrl+scroll to zoom"; read-only — "Nothing on the board yet."
- package.json — @use-gesture/react only.
- Definition of done: vitest, tsc, next build all green; manual pass on trackpad (pinch+two-finger), mouse (ctrl+wheel, middle-drag), and a phone width.

6) OUT OF V1 (explicitly deferred, do not build)
- Multi-select / marquee, card resize handles, rotation, connectors/arrows.
- Image caption EDITING and image lightbox zoom beyond the Sheet; Duplicate button.
- Websocket cursors / presence / true CRDT merge (jsonb-merge SQL function is the named future fix if the RMW window ever bites).
- Touch-tablet editing; virtualization (unnecessary ≤200 DOM nodes); minimap; export.
- Deleting/migrating the reference_media column or its upload endpoints — column stays authoritative for anything else that reads it.

7) DECISIONS LOG
1. Hand-rolled DOM canvas + @use-gesture/react@^10.3.1; tldraw rejected on watermark/commercial license, react-flow on graph semantics, konva on raster-vs-editable-DOM, dnd-kit on scale-compensation + React-19 friction, fully hand-rolled gestures on wheel/pinch normalization risk.
2. Board replaces the References card UI, placed full-width below the existing grid; shot list/deliverables/date lock untouched. One moodboard surface, not two.
3. reference_media is never migrated or mutated; board seeds from it in memory with DETERMINISTIC ids (`seed-<ref.id>`) so concurrent first-persists merge instead of duplicating; persisted only on first user action.
4. Persistence = `canvas_op {upsert, remove}` merged server-side per card in the existing PATCH route → per-card last-write-wins; small server RMW window documented and accepted for v1.
5. World clamp ±20,000; zoom 25–200%; note text ≤4000, label ≤120; cap 200 cards; only width stored (fixed per kind), height intrinsic.
6. Arrow = 10px, Shift+Arrow = 1px; delete is confirm-free with 5s Undo toast; single-select only.
7. Edit mode and drag are mutually exclusive per card (double-click edits, 4px threshold preserves clicks) — sidesteps the draggable-vs-editable conflict entirely.
8. Realtime reloads deferred during in-flight drag/edit; local edit text wins until commit.
9. Mobile/coarse-pointer and canEdit=false = pan/zoom/read + tap-to-Sheet only.
10. Migration file is feature-named (supabase/canvas_board.sql) matching repo convention, not numbered.
