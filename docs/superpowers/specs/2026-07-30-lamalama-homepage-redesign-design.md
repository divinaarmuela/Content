# MD Media — Lama-Lama-Style Homepage Redesign
**Date:** 2026-07-30
**Scope:** Replace `/` (homepage) with a design modelled on lamalama.com's layout system, typography, and scroll animations — using MD Media's own copy, data, logo, and imagery throughout. All other pages untouched.

---

## Overview

Rebuild the homepage in the Lama Lama visual language: charcoal dotted-texture background, huge cream uppercase grotesque headlines, terminal-style monospace micro-labels, a floating contextual nav pill, a fixed bottom metadata bar, a 0%→100% preloader, and scramble/decode text animations triggered on scroll.

We replicate the **look and interaction patterns**, not their assets: no Lama Lama copy, images, fonts, or code is reused. Fonts are free equivalents; all animation code is written in-house.

The current homepage components (`app/components/home/*`, `SiteNav`) are **preserved on disk** — nothing in `app/components/home/` is deleted or edited. The new homepage uses a fresh component set.

---

## Design Tokens

| Token | Value |
|---|---|
| Background | `#1a1c1c` (charcoal), `#000` for loader/overlay menu |
| Text | `#f9f4eb` (warm cream) headings & body; `rgba(249,244,235,0.65)` secondary |
| Accent | `#298dff` (existing MD Media blue — used sparingly: live-clock dot, hover states) |
| Dotted texture | CSS `background-image: radial-gradient(...)` tile, ~4px dot spacing, `rgba(249,244,235,0.07)` dots on `#1a1c1c` |
| Heading font | **Archivo** (Google Fonts, via `next/font`) — 700, UPPERCASE, `line-height: 0.8`, `letter-spacing: -0.02em` |
| Mono font | **Sometype Mono** (Google Fonts, via `next/font`) — micro-labels, tags, nav pill, metadata bar |
| Body font | Archivo 400, mixed case, large sizes (~clamp 20–28px) |
| Micro-label style | Mono, 11–12px, uppercase, bracketed: `[ FEATURED WORK ]`, `( + )` |
| Tag chips | Mono uppercase in 1px-bordered boxes, `border: 1px solid rgba(249,244,235,0.25)` |
| Buttons | Mono uppercase, 1px-bordered rectangles with `↗` arrow; hover inverts to cream fill / charcoal text |

---

## Architecture

New files:

- `app/components/lama/useScramble.ts` — scramble/decode hook (see Animations).
- `app/components/lama/LamaLoader.tsx`
- `app/components/lama/LamaNav.tsx`
- `app/components/lama/LamaHero.tsx`
- `app/components/lama/LamaIntro.tsx`
- `app/components/lama/LamaWork.tsx`
- `app/components/lama/LamaServices.tsx`
- `app/components/lama/LamaLogos.tsx`
- `app/components/lama/LamaCulture.tsx`
- `app/components/lama/LamaContact.tsx`
- `app/components/lama/LamaFooterBar.tsx`
- `app/components/lama/workData.ts` — the 7-client array extracted from `app/work/page.tsx` (moved to a shared module; `/work` page imports from it too, so data lives in one place)

Changed files:

- `app/page.tsx` — replaced entirely: renders the Lama component stack.
- `app/work/page.tsx` — one edit only: import client data from `workData.ts` instead of its inline array.
- `tailwind.config.js` — extended with the design tokens (colors, fonts, marquee/reveal keyframes).

**Styling: Tailwind-first.** All component styling uses Tailwind utility classes (v3.4, already installed). No new stylesheet; `globals.css` untouched. Custom CSS only where Tailwind cannot express it: keyframes and theme tokens go in `tailwind.config.js` (`theme.extend`), and the dotted texture is an arbitrary-value utility (`bg-[radial-gradient(rgba(249,244,235,0.07)_1px,transparent_1px)] [background-size:4px_4px]`).

No new dependencies. No GSAP — custom hooks + IntersectionObserver + Tailwind transitions.

---

## Animations

### Scramble/decode (`useScramble`)
- Given target text, renders a scrambling sequence of glyphs from a charset (`#(_>@%$*+·`) that resolves left-to-right into the real text over ~0.8–1.2s.
- Triggered by IntersectionObserver when the element enters the viewport (once per element, ~20% threshold).
- Applied to: micro-labels, nav pill title (on section change), metadata bar items (re-scramble on scroll direction change, throttled), buttons on hover.
- Headlines and body paragraphs do **not** scramble (matches Lama Lama): they use a simple fade/translate-up reveal on scroll-into-view.
- Respects `prefers-reduced-motion`: renders final text immediately, no loops.

### Preloader (`LamaLoader`)
- Fixed full-viewport black overlay, centred mono `0%` counting to `100%` (~1.5s, eased), then the overlay fades and the hero micro-label + metadata bar scramble in.
- Runs on every visit to `/` (matches the reference site) but content behind it is real DOM — no layout shift, SEO unaffected. Skipped entirely under `prefers-reduced-motion`.

---

## Chrome (persistent UI)

### `LamaNav` — floating contextual pill
- Fixed, centred top, `z-index` above all sections. Black pill: MD logo mark left, mono section title centre, hamburger right.
- Section title swaps (with scramble) as sections scroll past, driven by IntersectionObserver on each section. Titles use MD Media's own voice, mapped per section:
  - Hero → `MD MEDIA MARKETING`
  - Intro/Work → `SELECTED WORK`
  - Services → `WHAT WE DO`
  - Logos/Culture → `WHO WE ARE`
  - Contact → `BOOK A CALL`
- Hamburger → full-screen black overlay menu: Services / About / Contact / Work links + `Book a strategy call` (Calendly URL, same as `SiteNav` uses). Large Archivo uppercase items, mono index numbers.
- Homepage only. Other pages keep `SiteNav`.

### `LamaFooterBar` — fixed bottom metadata strip
- Full-width thin strip, top hairline border, mono 11px items spread across:
  `EST. 2024` · `MELBOURNE BASED` · `[ ● HH : MM : SS ]` live clock (blue dot) · `FOLLOW US` · `INSTAGRAM +` · `LINKEDIN +`
- Items briefly scramble while the user scrolls (throttled to avoid constant churn).
- Hidden on screens < 640px.

---

## Sections (in order)

### 1. `LamaHero`
- `100dvh`, dotted-texture charcoal, no video.
- Top-left mono label: `[ MD MEDIA MARKETING ]`.
- Headline (current copy, restyled): `YOU'RE THE BEST-KEPT SECRET IN YOUR MARKET. LET'S FIX THAT.` — Archivo 700 uppercase, cream, `clamp(3rem, 8vw, 7.5rem)`, lh 0.8, left-aligned, spans ~60% width.
- Right-aligned body block (current subheadline copy) at bottom-right, ~320px wide.
- Hairline rule above the metadata bar.

### 2. `LamaIntro`
- Large body paragraph (~clamp 28–44px), first line text-indented, using the current problem/solution copy ("Great businesses go unseen every day…" merged into one paragraph).
- `[ FEATURED WORK ]` mono label bottom-right, scrambles in.

### 3. `LamaWork`
- Full-width rows, hairline separators. Each row: client name (Archivo, mixed case, ~28px) left · tag chips (from each client's `services`, first 2–3, mono chips) · `( + )` · thumbnail strip right (3–4 images, `h≈140px`, from the existing Wix URLs).
- Thumbnails at low opacity, full opacity + slight scale on row hover. Whole row links to `/work`.
- All 7 clients included. Mobile: name + chips stack, thumbnails become horizontal scroll strip.

### 4. `LamaServices`
- Giant heading `WHAT WE DO.` (same scale as hero headline).
- Below: current services copy reorganized into three columns, each with a mono bracket label and a stacked list (Archivo 400, ~18px, one item per line):
  - `[ CONTENT ]` — Content Production, Social Media Management, Brand Photography, Video
  - `[ ADVERTISING ]` — Paid Ads (Meta), Performance Strategy, Lead Generation
  - `[ BRAND & STRATEGY ]` — Brand Strategy, Visual Identity, Strategy & Consulting
- List items sourced from the existing homepage/services copy; nothing invented beyond grouping.
- Mobile: columns stack.

### 5. `LamaLogos`
- Existing client-logo marquee (same logos and scroll behaviour as `HomeLogoStrip`) restyled: charcoal dotted bg, logos at reduced opacity, hairline rules above/below.

### 6. `LamaCulture`
- Split section: left ~55% large paragraph (current Why-Us copy condensed into one paragraph, first-line indent), right ~45% full-bleed photo (existing MD Media imagery; if none suitable, dark-toned Unsplash placeholder marked for swap).
- Top-left mono label: `[ WHY US ]`.

### 7. `LamaContact`
- Giant heading: `READY TO STOP BEING THE BEST-KEPT SECRET?` (current CTA copy, uppercase).
- Mono label `[ GET IN TOUCH ]`, short body line (current CTA body).
- Two bordered mono buttons: `BOOK A STRATEGY CALL ↗` (Calendly URL) and `SEE OUR WORK ↗` (`/work`).
- Generous bottom padding so the fixed metadata bar never overlaps.

There is no separate footer — `LamaContact` + `LamaFooterBar` close the page (matches reference).

---

## What's Preserved / Untouched

- `app/components/home/*` — all files remain on disk, unmodified
- `app/components/SiteNav.tsx` — unchanged, still used by other pages
- `app/globals.css` — untouched (new styles live in `lama.css`)
- `/work` page — visual/markup unchanged; only its data import moves to `workData.ts`
- All service pages, `/dashboard`, auth — untouched
- Calendly URL and all existing links preserved

## Out of Scope

- Right-side accumulating widget stack (Lama Lama's GET IN TOUCH / PITCHDECK cards) — not requested beyond "exactly like theirs" chrome; can be added later if missed
- Language toggle (MD Media is single-language)
- Restyling any page other than `/`
- Real culture-section photography (placeholder acceptable)

*(Note: the widget stack is listed out of scope because it has no MD Media content to fill it yet — flagged for the user in review.)*

## Error handling & testing

- Scramble hook must clean up `requestAnimationFrame`/intervals on unmount; observers disconnected on unmount.
- All animations no-op under `prefers-reduced-motion`.
- Wix thumbnail URLs already ship on `/work`; rows must not break layout if an image 404s (fixed-size boxes with `object-fit: cover`, charcoal fallback bg).
- Verify: `npm run build` passes; manual pass on mobile (390px), tablet, desktop; Lighthouse sanity check that the loader doesn't tank LCP (content is present behind overlay).
