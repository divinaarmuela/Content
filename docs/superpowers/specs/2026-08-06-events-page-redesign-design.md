# Events page redesign — faithful build of Events.dc.html

**Date**: 2026-08-06
**Source comp**: `~/Downloads/Events.dc.html` (design comp export, dark theme)
**Decision trail**: user chose "page first, CMS later" (no database work in this pass) and
"make the design like the event file" (reproduce the comp faithfully, including its own
nav and footer, rather than substituting the shared Lama components).

## Goal

Replace the current `/events` page (old cream `Site*` style, `GradientHero`) with a
pixel-faithful reproduction of the Events.dc.html comp: dark `#0B0B0B` editorial page,
Space Mono + Helvetica Neue type, its own fixed pill nav with overlay menu, film-still
hero, manifesto sections, thin-line upcoming listing, invite CTA, and 4-column footer.

## What ships

### Files

| File | Change |
|---|---|
| `app/events/page.tsx` | Rewritten: server component rendering all comp sections |
| `app/events/EventsNav.tsx` | New client component: comp's pill nav + overlay menu (menu open/close state) |
| `app/events/events.module.css` | New CSS module: keyframes (`mdm-in`, `mdm-draw`, `mdm-drift`, menu panel/row entrances), hover classes (`.row`, `.mirror` glass button), noise overlay |
| `app/events/layout.tsx` | Keep metadata (SEO/canonical correct as-is); remove `SiteNav` import since the page brings its own nav |

Nothing is added to `app/globals.css` (repo trap #2: marketing CSS leaks into the
dashboard). All styling is inline styles + the page-scoped CSS module, exactly
mirroring the comp's inline-style approach.

### Fonts

Space Mono loaded via `next/font/google` (weights 400/700, `display: swap`) inside the
events route only. Body type is the comp's `'Helvetica Neue', Helvetica, Arial,
sans-serif` system stack. No new global font variables.

### Sections (top to bottom, copy verbatim from the comp)

1. **Noise overlay** — fixed, `mix-blend-mode: overlay`, opacity 0.05, inline SVG
   fractal-noise data URI.
2. **Nav** — fixed centered pill: "MD MEDIA" wordmark left, "content-led" mono tag
   center, hamburger right. Opens the overlay **menu panel**: numbered rows 01–06
   (Work, What we do, About us, Journal, Events, Contact) with hover arrows, then
   "request an invite" outline button and "book a call" / "see our work" filled
   buttons. Link mapping to real routes:
   - Work → `/work`, What we do → `/#services`, About us → `/about`,
     Journal → `/journal`, Events → `/events`, Contact + book a call →
     `mailto:hello@mdmmarketing.com.au`, request an invite → `#join`,
     see our work → `/work`, wordmark → `/`.
3. **Hero** — 92vh, full-bleed background photo at opacity 0.4 with the 28s
   `mdm-drift` zoom animation and dark gradient overlay. Eyebrow `events / the room`,
   H1 "A room for the people / who are loud for a living." (second line at 55%
   white), subcopy paragraph. Photo: `public/MDM01011.jpg` as the film-still
   stand-in until the real still from a past room is supplied (single-constant swap).
4. **Why we do this** — 0.65fr/1.35fr grid: mono eyebrow + drawn rule left; H2 and
   two paragraphs right.
5. **This room isn't for everyone. And that's the point.** — large two-tone H2,
   numbered manifesto rows 01–04 with hairline dividers, accent closing line
   ("…this is the one.").
6. **What to expect** — 3-up auto-fit grid: Small by design / Mixed industries /
   No pitching, each with a drawn top rule.
7. **Upcoming rooms** (`#upcoming`) — header row + thin-line listing rows in a
   `130px 1fr auto 170px` grid: mono date, title, city, seats + hover arrow, each
   row linking to `#join`. Data comes from a hardcoded `upcoming` array at the top
   of `page.tsx` shaped for the future CMS swap:
   `{ date: string; title: string; city: string; seats: string }[]`.
   Ships with honest placeholders (no fake specifics):
   - `{ date: 'Date TBA', title: 'The Room, No. 01', city: 'Melbourne', seats: 'Seats capped' }`
   - `{ date: 'Date TBA', title: 'The Room, No. 02', city: 'Melbourne', seats: 'Seats capped' }`
   The comp's italic "swap in real events before publishing" note is replaced with
   the current page's honest line: "Dates, venues & capacity announced to the
   invite list first".
8. **Join** (`#join`) — centered "Sound like your kind of room?", subcopy, white
   pill mailto button `request an invite →` (subject "Request an invite — The Room",
   URL-encoded as in the comp).
9. **Footer** — comp's 4-column footer (brand blurb / explore / contact / social)
   with real routes; social links stay `#` until real URLs exist; bottom bar
   "AUSTRALIA · EST. 2024" / "© MD MEDIA, all rights reserved".

### Behaviour and interaction

- Accent color: `#FFFFFF` (comp default). Kept as a single constant in `page.tsx`.
- Entrance animations run on load via CSS (`animation … both`), matching the comp;
  no ScrollObserver dependency on this page.
- Menu open locks body scroll (as the comp's script does); Escape/overlay click
  closes. `EventsNav` is the only client component.
- The comp's `mdm-mirror` glass style is unused by any element in the comp body;
  it is **not** carried over (YAGNI).
- No em dashes anywhere in user-facing copy (site rule); comp copy already complies.
- **Responsive**: the comp is a 1280px desktop preview with fixed grids. Below
  ~760px the CSS module collapses them: listing rows go two-line (date/city/seats
  mono line above the title), the "why" grid and footer stack to one column, and
  the what-to-expect grid already auto-fits. Desktop rendering stays exactly per
  the comp.

### Out of scope (explicitly deferred)

- Supabase `events` table, `/api/website/events` routes, dashboard EventsAdmin tab
  (the "CMS later" pass — the `upcoming` array is the seam).
- RSVP/registration flow; the CTA stays mailto.
- Real event dates, cities, seat counts, and the hero film still (awaiting content).

## Verification

Per CLAUDE.md, all three must pass before the work is called done:
`npm test` (58 tests), `npx tsc --noEmit`, `npm run build`.
Plus a visual pass in the browser against the comp (nav, menu overlay, all sections,
hover states, mobile width ~390px where the listing grid must not overflow).

Note: building/running requires Supabase env vars (`lib/supabase.ts` throws at import
when missing). `.env.local` needed from the user, or stub values for local dev.
