# Dashboard Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the MD Media dashboard to the approved mockup (dark ink sidebar, cream canvas, big greeting, colour-tinted cards, calendar and today's timeline, larger type) without changing any behaviour.

**Architecture:** A shared shell and a small set of presentational components under `app/dashboard/ui/`, driven by brand tokens exposed as CSS variables on `.dbx`. Pages are restyled one at a time by swapping their markup onto those components; every page keeps its data hooks, API writes, role rules and tests.

**Tech Stack:** Next.js 16, React 19, Tailwind v3.4 (NOT v4), classic Radix shadcn, lucide-react icons, Inter Tight, vitest. Mockup: https://claude.ai/code/artifact/a952d413-f53e-473f-ba18-fbee823ccedc

**Spec:** `docs/superpowers/specs/2026-09-03-dashboard-look-design.md`

## Global Constraints

- Tailwind is v3 (CLAUDE.md trap 1). Classic Radix shadcn only. Never install a base-nova/Base UI component.
- Everything dashboard-side is scoped under `.dbx` (trap 2). No bare element selectors in `app/globals.css`.
- Dark mode keeps the elevation scale (trap 3): `--popover` lighter than `--card` lighter than `--background`.
- Exact tokens from the spec: ink `#0B0B0B`, cream `#f9f4eb`, paper `#ECE7D9`, surface `#ffffff`, blue `#0057FF`/`#0044CC`, green `#00C853`, amber `#FFB300`, red `#E53935`, tints `#DCE6FF` `#D6F5E1` `#FFEFC2` `#FBDAD8`, border `rgba(11,11,11,0.08)`, muted `rgba(11,11,11,0.62)`. Type scale: title 40/600 -0.03em, section 19/600, card 17/600, body 15, secondary 13, chip 12/600, stat 30/700. Radii: card 22, inner 16–18, pill 999, tile 12. Controls 44px; hit targets ≥44px.
- Logo `/MDLogo-trim.png` used as is (never inverted).
- No behaviour change: every `useTable`/`useRow`/`useLive` hook, API call, role check, 207 handling, dialog and test stays. Plain-words copy rules stay (`tests/plain-words.test.ts`).
- Mobile (390px) works on every restyled page: hamburger stays, cards stack, no horizontal scroll.
- Definition of done per task: `npm test`, `npx tsc --noEmit`, `npm run build` green; screenshots at 1440 and 390 compared against the mockup.
- Commit after every task with the trailers:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01FCQZcAEnczFkyHa5KkcKm9
  ```

---

## File map

| File | Responsibility |
|---|---|
| `app/globals.css` (`.dbx` block) | brand tokens as CSS variables, light + dark values |
| `tailwind.config.js` | `ink/cream/paper/tint-*` colour names mapped to the variables, radius tokens |
| `app/dashboard/ui/Shell.tsx` | sidebar + top bar + page frame (replaces the shell markup in `app/dashboard/layout.tsx`, which keeps nav data, role filtering, hamburger) |
| `app/dashboard/ui/TintCard.tsx`, `Stat.tsx`, `Chip.tsx` | tinted card, big number, pill |
| `app/dashboard/ui/Lane.tsx`, `WorkCard.tsx` | kanban lane and work card |
| `app/dashboard/ui/MiniCalendar.tsx`, `Timeline.tsx` | month grid with markers; today's list |
| `app/dashboard/ui/PageTitle.tsx` | 40px title + one-line summary |
| `tests/dashboard-ui.test.tsx`? | NO — this repo has no component tests; verification is screenshots + existing tests |

---

### Task 1: Tokens and Shell

**Files:** Modify `app/globals.css` (`.dbx` block only), `tailwind.config.js`, `app/dashboard/layout.tsx`. Create `app/dashboard/ui/Shell.tsx`, `app/dashboard/ui/PageTitle.tsx`.

- [ ] Read `app/dashboard/layout.tsx` fully (nav data, `SidebarHeader`, role filtering, mobile sheet). Read the `.dbx` block in `app/globals.css` and `tailwind.config.js`.
- [ ] Add CSS variables on `.dbx` for every token in the spec (light) and under `.dbx.dark` / the existing dark selector (dark: canvas `#0B0B0B`, surface `#141414`, tints as 18% accent overlays), keeping the shadcn variables the components already use consistent with the new canvas (`--background` = cream, `--card` = surface, `--popover` lighter than card in dark).
- [ ] Map Tailwind colour names: `ink`, `cream`, `paper`, `surface`, `tint-blue`, `tint-green`, `tint-amber`, `tint-red`, `accent-blue`, `accent-green`, `accent-amber`, `accent-red`; radius `card` 22px, `inner` 18px, `tile` 12px.
- [ ] `Shell.tsx`: sidebar 232px ink, logo at 26px high, group labels, nav items (18px lucide icons, cream 72% → active 12% cream fill), Settings pinned bottom; top bar with a 44px search pill (wire it to whatever search exists today, or leave as a visual placeholder that says so in a comment), the notification bell (reuse `NotificationBell.tsx`), and the avatar pill (name + initials, from the existing viewer data). Mobile: the existing hamburger sheet shows the same nav.
- [ ] `PageTitle.tsx`: `title`, `summary?`, `actions?` slot.
- [ ] Swap `layout.tsx` to render `Shell`; nothing else in the app changes yet. Run dev, screenshot `/dashboard` at 1440 and 390: the new shell around the old page.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`. Commit `feat(ui): brand tokens and the new dashboard shell`.

### Task 2: Cards, chips, stats, lanes, calendar, timeline

**Files:** Create `app/dashboard/ui/TintCard.tsx`, `Stat.tsx`, `Chip.tsx`, `Lane.tsx`, `WorkCard.tsx`, `MiniCalendar.tsx`, `Timeline.tsx`. Create `app/dashboard/ui/README.md` (one paragraph per component with a usage snippet).

- [ ] `TintCard({ tone, title, action?: { label, href }, children })` — tones `amber|blue|green|paper|surface`; 22px radius; 22/24px padding; title 17/600.
- [ ] `Stat({ value, label })` — 30/700 number, 12/500 muted label.
- [ ] `Chip({ tone, children })` — tones `ink|surface|blue|green|amber|red|muted`.
- [ ] `Lane({ title, count, children })` and `WorkCard({ client, title, thumb?, chips, people, tone?, href })` — matching the Board artboard; `tone` tints the whole card.
- [ ] `MiniCalendar({ month, markers: { date: 'shoot'|'post'|'review' }[], onMonthChange, onPick })` — Monday-first grid, today in ink, markers as tints; a 44px ink "Book a shoot" button slot below.
- [ ] `Timeline({ items: { time, title, detail, tone }[] })`.
- [ ] Mount all of them once on a temporary `/dashboard/_ui` route for a screenshot, then delete that route before committing. `npm test`, tsc, build. Commit `feat(ui): dashboard components for the new look`.

### Task 3: Overview

**Files:** Modify `app/dashboard/page.tsx` (and its small children as needed). Read `app/lib/overview-core.ts` (`buildOverview`) first — the numbers come from there and do not change.

- [ ] Layout per the Main artboard: `PageTitle` "Good morning/afternoon, {first name}" (reuse `Greeting.tsx` logic) with the one-line summary computed from the existing overview numbers; 2×2 `TintCard`s (Needs your action / amber; Going out this week / blue; Ready for review / green; Leads · 7 days / paper) whose `Stat`s are the existing overview fields; "Assigned to you" list as rows with tone by state; right rail `MiniCalendar` (markers from the live schedule entries, shoots and reviews the page already holds) + `Timeline` for today.
- [ ] Keep every role branch of the overview (client, scheduler, editor, account manager, super admin) rendering the same information it does now; only the presentation changes. Keep `LoadFailed` and the getting-started state.
- [ ] Screenshots 1440 + 390. `npm test`, tsc, build. Commit `feat(dashboard): overview in the new look`.

### Task 4: Production board

**Files:** Modify `app/dashboard/production/page.tsx`, `LaneBoard.tsx`, `ScopeSwitch.tsx`, `NewItemDialog.tsx` (buttons only).

- [ ] `PageTitle` "Production" + summary "N items across M clients · updates the moment anyone moves something"; the scope switch as a pill group; "New item" as a 44px ink pill.
- [ ] `LaneBoard` renders `Lane` + `WorkCard`; drag-and-drop, claim buttons, the group cards and every action stay wired exactly as now. Card tone: amber when due today, green when approved, blue when scheduled, ink when live.
- [ ] Two-tab live check still passes. Screenshots. Tests, tsc, build. Commit `feat(dashboard): production board in the new look`.

### Task 5: Editor and Scheduler

**Files:** Modify `app/dashboard/editor/page.tsx`, `app/dashboard/scheduler/page.tsx`, `app/dashboard/scheduler/ScheduleCalendar.tsx` (styling only).

- [ ] Same shell pieces: `PageTitle`, pill filters, `Lane`/`WorkCard` where the pages are boards, `TintCard` for their summary strips; `ScheduleCalendar` gets the calendar styling (tinted markers, 44px controls) without changing its data flow.
- [ ] Screenshots, tests, tsc, build. Commit `feat(dashboard): editor and scheduler in the new look`.

### Task 6: Everything else, light pass

**Files:** `app/dashboard/{clients,leads,bookings,social,team,reports,settings,notifications,ai}/**`, `app/dashboard/production/[id]/page.tsx`, `app/components/comments/CommentsDrawer.tsx`, dialogs under `app/dashboard/**`.

- [ ] Per page: `PageTitle`; old cards → `TintCard`/surface cards; old badges → `Chip`; primary buttons → 44px ink pills; tables keep their columns but get the new type scale and row height. Do not restructure any page. Dialogs: 22px radius, ink primary button.
- [ ] Batch of screenshots (every page at 1440, the five busiest at 390). Tests, tsc, build. Commit `feat(dashboard): remaining pages on the new look`.

### Task 7: Final review and handover

- [ ] Whole-branch review (code-reviewer) focused on: no behaviour drift (diff every page's hooks and fetches against `main`), `.dbx` scoping intact, dark mode elevation, mobile.
- [ ] Update `docs/PROJECT_STATE.md` with a short "Dashboard look — 3 Sep 2026" section and the mockup link.
- [ ] Merge menu for the owner.
