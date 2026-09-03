# Dashboard look — design

**Date:** 3 September 2026
**Status:** approved by the owner from the mockup (https://claude.ai/code/artifact/a952d413-f53e-473f-ba18-fbee823ccedc)
**Depends on:** the Firebase Realtime Database migration being merged to `main` first

## Goal

Make the dashboard look like the approved mockup: a dark ink sidebar, a cream canvas, a
large greeting, colour-tinted cards, a calendar with today's timeline, bigger and clearer
type everywhere. The owner's words: the current look is basic and everything is small.
No behaviour changes: every page keeps its data, its actions, its live listeners and its
role rules. This is a restyle, page by page, on top of a shared shell.

## Order

1. **Shell** — sidebar, top bar, page frame, tokens. Lands on every dashboard page at once.
2. **Overview** (`/dashboard`) — the mockup's first artboard.
3. **Production board** (`/dashboard/production`) — the mockup's second artboard.
4. **Editor** and **Scheduler** — same lane and card system as Production.
5. **Everything else** (clients, leads, bookings, social, team, reports, settings, item
   page, dialogs) — inherits the shell and tokens, then a light pass to swap old cards,
   chips and buttons for the new components. No page is redesigned from scratch.

## Design system (exact values)

| Token | Value | Use |
|---|---|---|
| ink | `#0B0B0B` | sidebar, primary buttons, headings |
| cream | `#f9f4eb` | page canvas, text on ink |
| paper | `#ECE7D9` | neutral tinted card |
| surface | `#ffffff` | plain cards, inputs, rails |
| blue | `#0057FF` / deep `#0044CC` | links, accents, scheduled |
| green | `#00C853` | approved, live |
| amber | `#FFB300` | needs action, due |
| red | `#E53935` | failed, overdue |
| tint blue | `#DCE6FF` | going out / scheduled cards |
| tint green | `#D6F5E1` | review / approved cards |
| tint amber | `#FFEFC2` | needs-action cards |
| tint red | `#FBDAD8` | overdue / failed cards (not in mockup; reserved) |
| border | `rgba(11,11,11,0.08)` | card borders |
| muted text | `rgba(11,11,11,0.62)` | secondary copy |

- Font: Inter Tight (already loaded). Scale: page title 40/600 (-0.03em), section title
  19/600, card title 17/600, body 15, secondary 13, chip 12/600, stat number 30/700.
- Radii: card 22px, inner card 16–18px, chip and button 999px, icon tile 12px.
- Controls: 44px high pills (search, buttons, avatar), hit targets never under 44px.
- Sidebar: 232px, ink, cream text at 72% (active: 12% cream fill, 100% text), group
  labels 11px uppercase at 38%. Logo: `/MDLogo-trim.png` as is (white with the blue
  slash); never inverted.
- Dark mode: keep the existing toggle. Dark canvas = ink `#0B0B0B` with surface
  `#141414`, tints become 18% overlays of their accent on surface. The elevation rule
  from CLAUDE.md trap 3 stays.
- Icons: lucide-react (already a dependency), stroke 1.8, 18px in nav, 16px in chips.

## Components (new, under `app/dashboard/ui/`)

- `Shell` — sidebar + top bar + frame. Replaces the shell markup in `app/dashboard/layout.tsx`;
  the nav data, role filtering and mobile hamburger behaviour move over unchanged.
- `TintCard` — `tone: 'amber' | 'blue' | 'green' | 'paper' | 'surface'`, title, action link, children.
- `Stat` — big number + label.
- `Chip` — tone + text.
- `Lane` and `WorkCard` — kanban lane with count; card with client, title, thumb (optional),
  chip row and avatars. Used by Production, Editor, Scheduler.
- `MiniCalendar` — month grid with tinted day markers (shoots amber, posts blue,
  reviews green). Reads from the same live rows the page already holds.
- `Timeline` — today's list (shoots, posts going live, client reviews) from live rows.

All Tailwind v3 utility classes plus the tokens as CSS variables on `.dbx`. Classic
Radix shadcn only (trap 1). Nothing styled outside `.dbx` (trap 2).

## What does not change

- Data: every page keeps its `useTable`/`useRow`/`useLive` listeners and API writes.
- Routes, role rules, scoping, the 207 handling, the claim paths.
- Copy: the plain-words rules stay; labels may get shorter, never more technical.
- The marketing site and the client portal (separate looks; not in scope).

## Testing

- `npm test`, `npx tsc --noEmit`, `npm run build` green after each page.
- A screenshot of each restyled page at 1440 and at 390 wide, compared by eye against the
  mockup; mobile keeps the hamburger and stacks the cards.
- Existing behaviour tests (scope parity, overview-core) are unchanged and must pass.
- Live check: the production board in two tabs still updates in real time after the restyle.
