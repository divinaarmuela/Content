# Events Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/events` with a faithful build of the Events.dc.html design comp: dark editorial page with its own pill nav + overlay menu, film-still hero, manifesto sections, thin-line upcoming listing, invite CTA, and 4-column footer.

**Architecture:** One server-component page (`app/events/page.tsx`) renders every section with inline styles mirroring the comp, plus one client component (`EventsNav.tsx`) for the menu state, plus one CSS module (`events.module.css`) for keyframes, hover states, and responsive grid collapses. `layout.tsx` keeps metadata and loses `SiteNav`. No database, no API, no globals.css changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, `next/font/google` (Space Mono), CSS Modules. Tailwind is NOT used on this page (the comp is inline-style based; mixing utility classes adds nothing).

**Spec:** `docs/superpowers/specs/2026-08-06-events-page-redesign-design.md`

## Global Constraints

- Nothing may be added to `app/globals.css` (marketing CSS leaks into the dashboard, repo trap #2).
- No em dashes in any user-facing copy.
- Copy comes verbatim from the comp except: bracketed placeholders (`[Month ##]`, `[City]`, `[##] seats`) ship as honest values, and the italic "swap in real events" note becomes "Dates, venues & capacity announced to the invite list first".
- Accent color is `#FFFFFF`, kept as a single `ACCENT` constant.
- Link mapping: Work → `/work`, What we do → `/#services`, About us → `/about`, Journal → `/journal`, Events → `/events`, Contact / book a call → `mailto:hello@mdmmarketing.com.au`, request an invite → `#join`, see our work → `/work`, wordmark → `/`.
- Before claiming completion: `npm test`, `npx tsc --noEmit`, and `npm run build` must all pass (CLAUDE.md rule). There is no component-test infrastructure in this repo (vitest covers lib functions only) and this plan does not add one; per-task verification is `tsc` + rendering checks.
- All commands run from the repo root: `/Users/akmalashwin/Documents/mdmediaugust/Content`.

---

### Task 1: CSS module with keyframes, hover states, and responsive grids

**Files:**
- Create: `app/events/events.module.css`

**Interfaces:**
- Produces class names consumed by Tasks 2 and 3: `anim`, `line`, `drift`, `overlay`, `panel`, `menuRow`, `menuIdx`, `menuArrow`, `menuBtn`, `menuFill`, `whyGrid`, `roomRow`, `roomDate`, `roomTitle`, `roomCity`, `roomEnd`, `roomArrow`, `footGrid`.

- [ ] **Step 1: Write the file**

```css
/* Page-scoped styles for /events — keyframes, hover states, and the grids
   that need media queries. Everything else is inline, mirroring the comp. */

@keyframes in {
  from { transform: translateY(16px); }
  to { transform: none; }
}
@keyframes draw {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
@keyframes drift {
  0% { transform: translate(0, 0) scale(1.06); }
  50% { transform: translate(-2%, -1.5%) scale(1.12); }
  100% { transform: translate(0, 0) scale(1.06); }
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes panelIn {
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to { opacity: 1; transform: none; }
}
@keyframes rowIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: none; }
}

.anim { animation: in 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }

.line {
  height: 1px;
  transform-origin: left;
  animation: draw 1.1s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.drift { animation: drift 28s ease-in-out infinite; }

/* menu overlay + panel */
.overlay { animation: fade 0.35s ease both; }
.panel { animation: panelIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }

.menuRow { animation: rowIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
.menuIdx { opacity: 0.3; transition: opacity 0.3s ease; }
.menuArrow { opacity: 0; transition: opacity 0.35s ease, transform 0.35s ease; }
.menuRow:hover .menuIdx { opacity: 1; }
.menuRow:hover .menuArrow { opacity: 1; transform: translate(3px, -3px); }

.menuBtn { transition: background 0.3s ease; }
.menuBtn:hover { background: rgba(255, 255, 255, 0.08); }
.menuFill { transition: background 0.3s ease; }
.menuFill:hover { background: rgba(255, 255, 255, 0.85); }

/* why-we-do-this two-column */
.whyGrid {
  display: grid;
  grid-template-columns: 0.65fr 1.35fr;
  gap: clamp(32px, 5vw, 90px);
  align-items: start;
}

/* upcoming listing row */
.roomRow {
  display: grid;
  grid-template-columns: 130px 1fr auto 170px;
  grid-template-areas: 'date title city end';
  gap: clamp(16px, 3vw, 44px);
  align-items: center;
  padding: clamp(28px, 3.6vh, 42px) 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  text-decoration: none;
  color: #fff;
}
.roomDate { grid-area: date; }
.roomTitle { grid-area: title; transition: opacity 0.35s ease; }
.roomCity { grid-area: city; }
.roomEnd { grid-area: end; display: flex; align-items: center; justify-content: flex-end; gap: 18px; }
.roomArrow { opacity: 0.4; transition: transform 0.4s ease, opacity 0.4s ease; }
.roomRow:hover .roomTitle { opacity: 0.55; }
.roomRow:hover .roomArrow { transform: translate(5px, -5px); opacity: 1; }

/* footer columns */
.footGrid {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr;
  gap: 40px;
  padding-bottom: 60px;
}

@media (max-width: 760px) {
  .whyGrid { grid-template-columns: 1fr; }
  .roomRow {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'date end'
      'title end'
      'city end';
    row-gap: 10px;
  }
  .roomCity { justify-self: start; }
  .footGrid { grid-template-columns: 1fr; gap: 32px; }
}
```

- [ ] **Step 2: Verify it compiles as a CSS module**

Run: `npx tsc --noEmit`
Expected: passes (no TS involvement yet, this confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add app/events/events.module.css
git commit -m "feat(events): page-scoped css module for comp rebuild"
```

---

### Task 2: EventsNav client component (pill nav + overlay menu)

**Files:**
- Create: `app/events/EventsNav.tsx`

**Interfaces:**
- Consumes: class names from `events.module.css` (Task 1).
- Produces: `export default function EventsNav(): JSX element` — no props. Rendered once by `page.tsx` (Task 3) inside the root wrapper div, which provides the `--font-space-mono` CSS variable.

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './events.module.css'

const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const EMAIL = 'mailto:hello@mdmmarketing.com.au'

const MENU_LINKS = [
  { href: '/work', label: 'Work' },
  { href: '/#services', label: 'What we do' },
  { href: '/about', label: 'About us' },
  { href: '/journal', label: 'Journal' },
  { href: '/events', label: 'Events' },
  { href: EMAIL, label: 'Contact' },
]

export default function EventsNav() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <nav style={{ position: 'fixed', top: 14, left: 0, right: 0, zIndex: 160, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 14px' }}>
        <div style={{ pointerEvents: 'auto', boxSizing: 'border-box', width: 'min(92vw, clamp(340px, 31vw, 560px))', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'rgba(11,11,11,0.82)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}>
          <Link href="/" style={{ justifySelf: 'start', textDecoration: 'none', color: '#ffffff', fontFamily: SANS, fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>MD&nbsp;MEDIA</Link>
          <span style={{ justifySelf: 'center', fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>content-led</span>
          <button onClick={() => setOpen(o => !o)} aria-label="Menu" style={{ all: 'unset', cursor: 'pointer', justifySelf: 'end', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, width: 22, height: 22 }}>
            <span style={{ display: 'block', height: 1.5, width: '100%', background: '#ffffff', transition: 'transform 0.45s cubic-bezier(0.16,1,0.3,1)', transform: open ? 'translateY(3.75px)' : 'none' }} />
            <span style={{ display: 'block', height: 1.5, width: '100%', background: '#ffffff', transition: 'opacity 0.3s ease', opacity: open ? 0 : 1 }} />
          </button>
        </div>
      </nav>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 170, background: 'rgba(11,11,11,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '14px 14px 28px', overflowY: 'auto' }}>
          <div className={styles.panel} onClick={e => e.stopPropagation()} style={{ width: 'min(92vw, clamp(340px, 31vw, 560px))', background: '#0B0B0B', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 110px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px clamp(15px, 1.8vw, 19px)', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
              <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em' }}>MD&nbsp;MEDIA</span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>get seen · get known · get booked</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" style={{ all: 'unset', cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ display: 'block', height: 1.5, width: 18, background: '#ffffff' }} />
              </button>
            </div>

            {MENU_LINKS.map((link, i) => (
              <Link key={link.label} href={link.href} className={styles.menuRow} onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px clamp(15px, 1.8vw, 19px)', borderBottom: '1px solid rgba(255,255,255,0.12)', textDecoration: 'none', color: '#ffffff', animationDelay: `${0.06 * (i + 1)}s` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <span className={styles.menuIdx} style={{ fontFamily: MONO, fontSize: 10, color: '#FFFFFF' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(0.95rem, 1.4vw, 1.1rem)', letterSpacing: '-0.02em' }}>{link.label}</span>
                </span>
                <span className={styles.menuArrow} style={{ fontFamily: MONO, fontSize: 13 }}>↗</span>
              </Link>
            ))}

            <div className={styles.menuRow} style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 9, animationDelay: '0.42s' }}>
              <a href="#join" className={styles.menuBtn} onClick={() => setOpen(false)} style={{ textDecoration: 'none', textAlign: 'center', color: '#ffffff', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: 14, border: '1px solid rgba(255,255,255,0.28)', borderRadius: 8 }}>request an invite</a>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                <a href={EMAIL} className={styles.menuFill} style={{ textDecoration: 'none', textAlign: 'center', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '14px 10px', borderRadius: 8 }}>book a call</a>
                <Link href="/work" className={styles.menuFill} style={{ textDecoration: 'none', textAlign: 'center', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '14px 10px', borderRadius: 8 }}>see our work</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add app/events/EventsNav.tsx
git commit -m "feat(events): comp-faithful pill nav with overlay menu"
```

---

### Task 3: Rewrite page.tsx and trim layout.tsx

**Files:**
- Modify: `app/events/page.tsx` (full rewrite)
- Modify: `app/events/layout.tsx` (remove SiteNav)

**Interfaces:**
- Consumes: `EventsNav` default export (Task 2), class names from `events.module.css` (Task 1), `public/MDM01011.jpg` (existing asset).
- Produces: the `/events` route. The `upcoming` array (`{ date: string; title: string; city: string; seats: string }[]`) is the future CMS seam.

- [ ] **Step 1: Rewrite `app/events/page.tsx`**

Replace the entire file with:

```tsx
import { Space_Mono } from 'next/font/google'
import EventsNav from './EventsNav'
import styles from './events.module.css'

const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-space-mono', display: 'swap' })

const ACCENT = '#FFFFFF'
const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const EMAIL = 'mailto:hello@mdmmarketing.com.au'
const INVITE = `${EMAIL}?subject=Request%20an%20invite%20%E2%80%94%20The%20Room`
const HERO_IMG = '/MDM01011.jpg' // stand-in until a film still from a past room is supplied

// Future CMS seam: this array becomes a Supabase fetch in the CMS pass.
const upcoming = [
  { date: 'Date TBA', title: 'The Room, No. 01', city: 'Melbourne', seats: 'Seats capped' },
  { date: 'Date TBA', title: 'The Room, No. 02', city: 'Melbourne', seats: 'Seats capped' },
]

const manifesto = [
  'It’s for you if you’ve ever left a “networking” event feeling like everyone was selling and no one was listening.',
  'It’s for you if you’re more interested in what someone does than what they can do for you.',
  'It’s for you if you get curious about industries that aren’t yours, if you’d rather ask a good question than deliver a good pitch.',
  'It’s for the givers. The ones who connect two people who’ll never work with them, just because it makes sense. The ones who show up to learn, not to leverage.',
]

const expect = [
  { title: 'Small by design', body: 'Capped numbers so every conversation can go somewhere real. You’ll meet the room, not a crowd.' },
  { title: 'Mixed industries', body: 'Founders, marketers, creators, and builders from different worlds, chosen for curiosity, not category.' },
  { title: 'No pitching', body: 'Come to learn, give, and connect. The best business that comes from these rooms is never the point of them.' },
]

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

export default function EventsPage() {
  return (
    <div className={spaceMono.variable} style={{ background: '#0B0B0B', color: '#ffffff', fontFamily: SANS, fontWeight: 400, WebkitFontSmoothing: 'antialiased', overflowX: 'hidden', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.05, backgroundImage: NOISE }} />

      <EventsNav />

      {/* HERO */}
      <header style={{ position: 'relative', minHeight: '92vh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '140px clamp(20px, 4vw, 52px) clamp(44px, 6vh, 72px)', overflow: 'hidden' }}>
        <div className={styles.drift} style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_IMG} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(11,11,11,0.55) 0%, rgba(11,11,11,0.5) 45%, #0B0B0B 100%)' }} />
        <div style={{ position: 'relative', zIndex: 3, width: '100%' }}>
          <p className={styles.anim} style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', margin: '0 0 30px' }}>events / the room</p>
          <h1 style={{ fontWeight: 500, fontSize: 'clamp(2.6rem, 8.5vw, 7.5rem)', lineHeight: 0.92, letterSpacing: '-0.045em', margin: '0 0 28px', maxWidth: 1100 }}>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em' }}>A room for the people</span></span>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em', color: 'rgba(255,255,255,0.55)' }}>who are loud for a living.</span></span>
          </h1>
          <p className={styles.anim} style={{ maxWidth: 600, fontSize: 'clamp(1.05rem, 1.5vw, 1.25rem)', lineHeight: 1.55, color: 'rgba(255,255,255,0.7)', margin: 0 }}>Small, intentional gatherings for founders, marketers, and builders who{'’'}d rather ask a good question than deliver a good pitch.</p>
        </div>
      </header>

      {/* WHY EVENTS */}
      <section style={{ padding: 'clamp(80px, 13vh, 170px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <div className={styles.whyGrid}>
          <div>
            <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT, margin: '0 0 22px' }}>why we do this</p>
            <div className={styles.line} style={{ background: 'rgba(255,255,255,0.3)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <h2 style={{ fontWeight: 500, fontSize: 'clamp(1.5rem, 3vw, 2.4rem)', lineHeight: 1.18, letterSpacing: '-0.025em', margin: 0, textWrap: 'balance' }}>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em' }}>We build visibility for a living, so we</span></span>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em' }}>know how lonely the work can be.</span></span>
            </h2>
            <p className={styles.anim} style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', margin: 0 }}>The people who put themselves out there every day, posting, pitching, building in public, rarely have a room that gets it. Most {'“'}networking{'”'} is transactional: everyone selling, no one listening.</p>
            <p className={styles.anim} style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', margin: 0 }}>So we started hosting the kind of gathering we always wanted to be in. No name-tag small talk, no leverage. Just genuinely interesting people, curious about each other{'’'}s work, in a space designed for real conversation. Content-led marketing is about connection, our events are simply that idea, offline.</p>
          </div>
        </div>
      </section>

      {/* WHO THIS ROOM IS FOR */}
      <section style={{ padding: 'clamp(80px, 13vh, 180px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)', background: '#0E0E0E' }}>
        <h2 style={{ fontWeight: 500, fontSize: 'clamp(2rem, 5.5vw, 4.4rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 clamp(48px, 7vh, 80px)', maxWidth: 1000, textWrap: 'balance' }}>
          <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em' }}>This room isn{'’'}t for everyone.</span></span>
          <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em', color: 'rgba(255,255,255,0.5)' }}>And that{'’'}s the point.</span></span>
        </h2>

        <div style={{ maxWidth: 1180 }}>
          <div className={styles.line} style={{ background: 'rgba(255,255,255,0.2)' }} />
          {manifesto.map((text, i) => (
            <div key={i} className={styles.anim} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 'clamp(18px, 3vw, 44px)', alignItems: 'start', padding: 'clamp(26px, 3.4vh, 38px) 0', borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: ACCENT }}>{String(i + 1).padStart(2, '0')}</span>
              <p style={{ fontSize: 'clamp(1.15rem, 2vw, 1.7rem)', lineHeight: 1.35, letterSpacing: '-0.015em', margin: 0, color: 'rgba(255,255,255,0.92)', textWrap: 'balance' }}>{text}</p>
            </div>
          ))}
        </div>

        <p className={styles.anim} style={{ fontSize: 'clamp(1.3rem, 2.6vw, 2.2rem)', lineHeight: 1.3, letterSpacing: '-0.02em', margin: 'clamp(48px, 7vh, 80px) 0 0', maxWidth: 900, textWrap: 'balance' }}>If you{'’'}re loud for a living, content, marketing, social, building something, but you{'’'}ve never had a room that actually gets it{'…'} <span style={{ color: ACCENT }}>this is the one.</span></p>
      </section>

      {/* WHAT TO EXPECT */}
      <section style={{ padding: 'clamp(80px, 12vh, 160px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: '0 0 clamp(40px, 6vh, 64px)' }}>what to expect</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'clamp(28px, 4vw, 60px)' }}>
          {expect.map(item => (
            <div key={item.title} className={styles.anim}>
              <div className={styles.line} style={{ background: 'rgba(255,255,255,0.3)', marginBottom: 24 }} />
              <h3 style={{ fontWeight: 500, fontSize: 'clamp(1.3rem, 2vw, 1.7rem)', letterSpacing: '-0.02em', margin: '0 0 12px' }}>{item.title}</h3>
              <p style={{ fontSize: '1rem', lineHeight: 1.55, color: 'rgba(255,255,255,0.58)', margin: 0 }}>{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* UPCOMING */}
      <section id="upcoming" style={{ padding: 'clamp(70px, 11vh, 150px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'clamp(20px, 3vh, 36px)' }}>
          <h2 style={{ fontWeight: 500, fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)', letterSpacing: '-0.03em', margin: 0 }}>Upcoming rooms</h2>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>by invitation</span>
        </div>

        <div className={styles.line} style={{ background: 'rgba(255,255,255,0.25)' }} />

        {upcoming.map(room => (
          <a key={room.title} href="#join" className={`${styles.roomRow} ${styles.anim}`}>
            <span className={styles.roomDate} style={{ fontFamily: MONO, fontSize: 12, color: ACCENT }}>{room.date}</span>
            <h3 className={styles.roomTitle} style={{ fontWeight: 500, fontSize: 'clamp(1.3rem, 2.4vw, 2rem)', letterSpacing: '-0.02em', margin: 0 }}>{room.title}</h3>
            <span className={styles.roomCity} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{room.city}</span>
            <div className={styles.roomEnd}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{room.seats}</span>
              <span className={styles.roomArrow} style={{ fontSize: '1.2rem' }}>↗</span>
            </div>
          </a>
        ))}

        <p style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: '28px 0 0' }}>Dates, venues &amp; capacity announced to the invite list first</p>
      </section>

      {/* JOIN */}
      <section id="join" style={{ scrollMarginTop: 70, position: 'relative', padding: 'clamp(100px, 16vh, 210px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)', textAlign: 'center' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 500, fontSize: 'clamp(2rem, 5.5vw, 4.6rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 28px' }}>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.anim} style={{ display: 'block', paddingBottom: '0.08em' }}>Sound like your kind of room?</span></span>
          </h2>
          <p style={{ maxWidth: 540, margin: '0 auto 40px', fontSize: 'clamp(1.05rem, 1.5vw, 1.22rem)', lineHeight: 1.55, color: 'rgba(255,255,255,0.6)' }}>Rooms are kept small and curated, so entry is by request. Tell us a little about what you do and we{'’'}ll be in touch.</p>
          <a href={INVITE} style={{ textDecoration: 'none', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 14, letterSpacing: '0.04em', padding: '17px 36px', borderRadius: 100, display: 'inline-flex', alignItems: 'center', gap: 10 }}>request an invite <span style={{ fontSize: 16 }}>→</span></a>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.16)', padding: 'clamp(48px, 7vh, 80px) clamp(20px, 4vw, 52px) 36px' }}>
        <div className={styles.footGrid}>
          <div>
            <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>MD&nbsp;MEDIA</span>
            <p style={{ maxWidth: 280, fontSize: '0.98rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.5)', margin: '18px 0 0' }}>Content-led marketing for founders and local businesses ready to be seen, known, and booked.</p>
          </div>
          <div>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>explore</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
              <a href="/" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>Home</a>
              <a href="/work" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>Work</a>
              <a href="/about" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>About</a>
              <a href="/journal" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>Journal</a>
              <a href="/events" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>Events</a>
            </div>
          </div>
          <div>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>contact</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
              <a href={EMAIL} style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>hello@mdmmarketing.com.au</a>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.96rem' }}>Australia · remote &amp; on location</span>
            </div>
          </div>
          <div>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>social</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
              <a href="#" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>Instagram</a>
              <a href="#" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>LinkedIn</a>
              <a href="#" style={{ textDecoration: 'none', color: 'rgba(255,255,255,0.7)', fontSize: '0.96rem' }}>TikTok</a>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, paddingTop: 26, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>AUSTRALIA · EST. 2024</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>© MD MEDIA, all rights reserved</span>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Trim `app/events/layout.tsx`**

Replace the entire file with (metadata unchanged, `SiteNav` gone):

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'The Room — Events by MD Media, Melbourne',
  description:
    'Small, invite-first rooms for Melbourne business owners and operators. No pitches, no panels reading slides — real conversations about growing a business.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/events' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/events',
    title: 'The Room — Events by MD Media',
    description: 'Small, invite-first rooms for Melbourne business owners and operators.',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

(The metadata description keeps its existing em dash — it is pre-existing `<head>` metadata, not new page copy; flag to the user rather than silently changing SEO text.)

- [ ] **Step 3: Type-check and render**

Run: `npx tsc --noEmit`
Expected: passes.

Run (dev server on :3000 already running, else `npm run dev` first):
`curl -s http://localhost:3000/events | grep -o "loud for a living" | head -1`
Expected: `loud for a living`

`curl -s http://localhost:3000/events | grep -c "GradientHero\|ed-main"`
Expected: `0` (old page fully gone).

- [ ] **Step 4: Commit**

```bash
git add app/events/page.tsx app/events/layout.tsx
git commit -m "feat(events): rebuild /events from Events.dc.html comp"
```

---

### Task 4: Full verification pass

**Files:** none (verification only; fix-forward commits if anything fails)

- [ ] **Step 1: Run the full gate**

```bash
npm test          # expected: 58 tests pass
npx tsc --noEmit  # expected: clean
npm run build     # expected: build succeeds (stub Supabase env vars in .env.local suffice)
```

All three must pass (CLAUDE.md rule). If any fail, fix and re-run before proceeding.

- [ ] **Step 2: Visual check against the comp**

With the dev server running, open `http://localhost:3000/events` in the browser and verify at 1280px and ~390px widths:
- pill nav fixed top-center; hamburger opens the overlay menu; rows 01–06 hover-reveal arrows; Escape and overlay click close it; body scroll locks while open
- hero photo drifts slowly, headline two-tone, entrance animations play once
- manifesto rows 01–04 with hairline dividers; accent closing line
- what-to-expect 3-up on desktop, stacked on mobile
- upcoming rows: 4-column line on desktop, stacked (date/title/city left, seats+arrow right) on mobile, no horizontal overflow
- join CTA opens the mailto with subject "Request an invite — The Room"
- footer 4 columns desktop / 1 column mobile

- [ ] **Step 3: Report**

Report results honestly, including anything that fails or looks off versus the comp.
