# About page redesign — faithful build of About.dc.html

**Date**: 2026-08-06
**Source comp**: `~/Downloads/About.dc.html`
**Pattern**: identical treatment to the events page rebuild (approved 2026-08-06):
faithful comp reproduction, shared `LamaNav`/`LamaFooter` instead of the comp's
inline nav/footer, Space Mono via `next/font`, page-scoped CSS module, nothing in
`globals.css`, no em dashes in copy.

## Sections (copy verbatim from comp)

1. **Hero** — 78vh, drift photo (26s) at 0.4 opacity with gradient; eyebrow
   `about / the studio`; H1 "We make good businesses / impossible to ignore.";
   subcopy. Hero photo: `public/martindivina.avif` as the studio/team film-still
   stand-in (single-constant swap).
2. **Why we exist** — 0.7fr/1.3fr grid; 3-line H2 ("Most agencies are built by
   marketers…"); three story paragraphs (Divina + Martin, late 2024, team of 14).
3. **What we believe** — four hairline rows in a `90px 1fr 1.3fr` grid:
   Visibility comes first / It has to sound like you / One partner beats five
   freelancers / Grow at the right pace. (Replaces the old page's four beliefs —
   the comp wins.)
4. **The team** — header pair, then five collapsible department rows (accordion,
   one open at a time, Leadership open by default, `+` rotates 45° when open):
   01 Leadership (Divina, Martin, Abby, Yusuf) · 02 Client Accounts (Lulu, Manal)
   · 03 Social & Content (Karly, Renee, Raven) · 04 Brand & Technology (Daniela,
   Akmal) · 05 Production (Ryan, Sebastian, Sarina). Cards are 4:5 rounded tiles
   with a film-grain fade animation. **No team photos exist in the repo or
   Downloads**, so cards render a dark `#141414` placeholder tile with the
   member's initial and mono role until photos land in `public/team/` (each
   member has an optional `img` field — filling it swaps the tile for the photo).
5. **CTA** — "Let's make your business / the one people have heard of." +
   white pill `start now →` mailto button.
6. **Footer** — `LamaFooter vol="About · team of 14"`.

## Behaviour

- Scroll reveal: the comp reveals `[data-anim]` blocks on scroll. Implemented as
  a small client observer (`AboutReveal`) bound to the page CSS module's
  `.reveal`/`.shown` classes — same mechanism as the site's ScrollObserver but
  scoped to this page's module, not globals.
- Accordion state lives in one client component (`AboutTeam`); everything else
  is server-rendered.
- Accent `#FFFFFF` constant, as events.

## Files

- Rewrite `app/about/page.tsx`; create `app/about/AboutTeam.tsx`,
  `app/about/AboutReveal.tsx`, `app/about/about.module.css`.
- `app/about/layout.tsx`: keep metadata, drop `SiteNav`.

## Out of scope

Real team photos, CMS management of team/beliefs, social URLs.

## Verification

`npm test` + `npx tsc --noEmit` + `npm run build`, plus render checks of
`/about` (hero, accordion toggle, all five departments, mobile ~390px).
