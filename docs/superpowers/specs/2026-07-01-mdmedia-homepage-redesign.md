# MD Media — Homepage Redesign Spec
**Date:** 2026-07-01
**Scope:** Replace `/` (homepage) with new design. All other pages untouched.

---

## Overview

Rebuild the MD Media homepage with the new brand positioning copy (content-led, full-suite, founders & local businesses) and a Ciridae-inspired dark aesthetic: video hero, glassmorphism cards, all-caps tracked typography, parallax sections, full-bleed image panels, and blurred colour-blob CTAs.

The existing homepage components (`GradientHero`, `FrameSequenceBg`, `IPhoneFloat`, etc.) are **preserved** — other service pages still use them. The new homepage uses a completely separate component set.

---

## Architecture

### New shared component
- `SiteNav` — fixed top bar used across all new public pages. Logo left, nav links centre (`Services · About · Contact`), pill CTA right (`Book a strategy call`). Dark background with backdrop blur. Thin bottom border. No existing nav to conflict with.

### New page
- `app/page.tsx` — replaced entirely with new sections below.

### New components (all in `app/components/home/`)
- `HomeVideoHero`
- `HomeLogoStrip` (reuses existing marquee logic)
- `HomeProblem`
- `HomeSolution`
- `HomeServices`
- `HomeHowItWorks`
- `HomeWhyUs`
- `HomeTestimonial`
- `HomeCtaBanner`

---

## Visual Language

| Token | Value |
|---|---|
| Background | `#0a0a0a` default, `#000` for statement screens |
| Text | `#ffffff` headings, `rgba(255,255,255,0.65)` body |
| Card bg | `rgba(255,255,255,0.06)` |
| Card border | `1px solid rgba(255,255,255,0.12)`, backdrop-filter blur |
| Accent | `#298dff` (preserved from existing brand) |
| Border radius | `16px` cards, `999px` pill buttons |
| Typography | All-caps tracked (`letter-spacing: 0.08em`) for labels/headings; mixed case for body |
| Button fill | `#fff` text on dark bg / `#0a0a0a` text on white fill |

---

## Sections

### 1. `HomeVideoHero`
- Fullscreen (`100dvh`) `<video>` — `src: https://stabondar.b-cdn.net/ciridae/hero_web.mp4`, autoplay, muted, loop, playsInline
- `SiteNav` overlaid at top
- Centred content: small all-caps tag `· MD MEDIA MARKETING ·`, large headline, two pill CTAs
- **Headline:** "You're the best-kept secret in your market. Let's fix that."
- **CTAs:** `Book a strategy call` (filled white) + `See how we work` (outline, scrolls to `#solution`)
- Grain overlay (`filmhero-grain` class, already in globals.css)
- Dark gradient at bottom to blend into next section

### 2. `HomeLogoStrip`
- Identical to existing `GradientHero` marquee — same client logos, same scrolling behaviour
- Dark background (`#0a0a0a`), no section padding
- Reuses the existing `logos-track` CSS or duplicates it into a new class

### 3. `HomeProblem`
- Full viewport height, pure black (`#000`), centred flex
- Small all-caps label: `· THE PROBLEM ·`
- Large statement heading: "Great businesses go unseen every day."
- Two lines of body copy below (from copy doc)
- Nothing else — maximum whitespace

### 4. `HomeSolution`
- Parallax dark texture/photo background (use CSS `background-attachment: fixed` or a static dark image)
- Three glassmorphism cards staggered vertically, appearing on scroll
- Each card: numbered pill (`01` `02` `03`), title, one-line body, small icon bottom-right
- Cards: `Content First`, `Scale Into It`, `One Team`
- Blurred border (`backdrop-filter: blur(12px)`), `border-radius: 16px`

### 5. `HomeServices`
- Pure black background
- Centred all-caps heading: "Start with content. Scale into the rest."
- Four full-bleed vertical image panels in a horizontal row
- Each panel: abstract texture image (placeholder from Unsplash until real assets), numbered pill, service name bottom-left
- On hover: panel expands (flex-grow), body copy fades in
- Services: `Content & Visibility` / `Paid Advertising` / `Branding Suite` / `Strategy & Consulting`
- Mobile: stacks vertically, no expand behaviour (tap reveals copy)

### 6. `HomeHowItWorks`
- Dark background (`#0a0a0a`)
- Section label centred: `· HOW IT WORKS ·`
- Heading: "From invisible to in-demand, in three steps."
- Three steps in a column — each: large left number `01/02/03`, bold step title right, body below title
- Generous vertical spacing between steps
- Single pill CTA at bottom: `Book your strategy call`

### 7. `HomeWhyUs`
- Dark background
- Section label + heading: "Why founders and local businesses choose us."
- 2×2 grid of glassmorphism cards — same card style as `HomeSolution`
- Four reasons from copy doc (each: short bold title + 1–2 lines body)

### 8. `HomeTestimonial`
- Full-width, pure black, generous vertical padding
- Large centred quote (placeholder: `[Client quote goes here]`)
- Thin horizontal rule above/below attribution
- Attribution: name, business, location

### 9. `HomeCtaBanner`
- Blurred colour-blob ambient background — CSS radial gradients (`#298dff`, dark teal, black) with `filter: blur(80px)` blobs underneath dark overlay
- Centred: headline `"Ready to stop being the best-kept secret?"`, short body, single large pill CTA
- Transitions into the site footer

---

## `SiteNav` Detail

```
[MD MEDIA logo/wordmark]    [Services] [About] [Contact]    [Book a strategy call →]
```

- `position: fixed`, `z-index: 100`, full width
- Background: `rgba(10,10,10,0.8)` + `backdrop-filter: blur(16px)`
- Bottom border: `1px solid rgba(255,255,255,0.08)`
- On scroll past hero: border becomes slightly more visible
- Mobile: hamburger → full-screen dark overlay menu
- The pill CTA links to Calendly URL (same as existing pages)

---

## Copy (from brief — placeholders noted)

All copy is sourced directly from the MD Media copy doc. Items in `[brackets]` remain as placeholders until real data is confirmed. No copy is invented.

---

## What's Preserved / Untouched

- `app/components/GradientHero.tsx` — unchanged
- `app/components/FrameSequenceBg.tsx` — unchanged
- `app/components/IPhoneFloat.tsx` — unchanged
- `app/components/ServiceList.tsx` — unchanged
- `app/marketing/page.tsx` — unchanged
- `app/branding/page.tsx` — unchanged
- All other service pages — unchanged
- `app/globals.css` — additive only (new classes appended, nothing removed)
- `/work`, `/dashboard` — untouched

---

## Out of Scope (this sprint)

- `/services`, `/about`, `/contact` pages — follow-on sprints
- Real client testimonial content
- Real abstract texture images for service panels
- Lenis smooth scroll integration (existing scroll behaviour retained)
