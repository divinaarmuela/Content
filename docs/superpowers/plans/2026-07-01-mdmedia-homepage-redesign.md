# MD Media Homepage Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `app/page.tsx` with a new dark, Ciridae-inspired homepage — video hero, glassmorphism cards, parallax sections, full-bleed image panels — using the new MD Media brand copy.

**Architecture:** Nine purpose-built section components live in `app/components/home/`. The existing `SiteNav` is updated in-place to add page links and a pill CTA. All existing service-page components are untouched. CSS is appended to `app/globals.css`.

**Tech Stack:** Next.js 14 App Router, TypeScript, plain CSS (no new deps)

## Global Constraints

- `app/globals.css` — additive only; never remove or rename existing classes
- All existing components in `app/components/` — never modify except `SiteNav.tsx`
- Calendly URL: `https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone`
- Video URL: `https://stabondar.b-cdn.net/ciridae/hero_web.mp4`
- Brand blue: `#298dff`
- Copy source: MD Media copy doc (no invented content; `[bracket]` items left as-is)
- Australian English spelling throughout
- `'use client'` on every component that uses hooks or event handlers

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `app/components/SiteNav.tsx` | Add `/services` `/about` `/contact` links + pill CTA |
| Create | `app/components/home/HomeVideoHero.tsx` | Fullscreen video, headline, CTAs |
| Create | `app/components/home/HomeLogoStrip.tsx` | Scrolling client logo marquee |
| Create | `app/components/home/HomeProblem.tsx` | Full-viewport black statement screen |
| Create | `app/components/home/HomeSolution.tsx` | Parallax bg + 3 glassmorphism cards |
| Create | `app/components/home/HomeServices.tsx` | 4 image panels with hover-expand |
| Create | `app/components/home/HomeHowItWorks.tsx` | 3 numbered steps |
| Create | `app/components/home/HomeWhyUs.tsx` | 2×2 glassmorphism card grid |
| Create | `app/components/home/HomeTestimonial.tsx` | Centred dark quote screen |
| Create | `app/components/home/HomeCtaBanner.tsx` | Colour-blob ambient bg + CTA |
| Modify | `app/page.tsx` | Replace with new homepage assembly |
| Modify | `app/globals.css` | Append all new CSS (additive) |

---

## Task 1: Update SiteNav

**Files:**
- Modify: `app/components/SiteNav.tsx`

**Interfaces:**
- Produces: `SiteNav` component with links to `/services`, `/about`, `/contact` and a Calendly pill CTA

- [ ] **Step 1: Replace the nav links and add the CTA**

Open `app/components/SiteNav.tsx`. Replace the `<nav>` block and outer `<header>` return so the full component reads:

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

function NavLogo() {
  const [ok, setOk] = useState(true)
  return (
    <a href="/" className="site-nav-name" aria-label="MD Media Marketing home">
      {ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/MDLogo-trim.png"
          alt="MD Media Marketing"
          className="nav-logo-img"
          onError={() => setOk(false)}
        />
      ) : (
        'MD Media Marketing'
      )}
    </a>
  )
}

type Lenis = { scrollTo: (target: number | string | HTMLElement, opts?: Record<string, unknown>) => void }

export default function SiteNav() {
  const [scrolled,  setScrolled]  = useState(false)
  const [hidden,    setHidden]    = useState(false)
  const [overVideo, setOverVideo] = useState(false)

  useEffect(() => {
    let lastY = window.scrollY

    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 40)
      if (y < 80) {
        setHidden(false)
      } else {
        setHidden(y > lastY)
      }
      lastY = y

      const vs = document.querySelector('.video-stack') as HTMLElement | null
      if (vs) {
        const rect = vs.getBoundingClientRect()
        setOverVideo(rect.top < 80 && rect.bottom > 0)
      }
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleAnchor = (e: React.MouseEvent<HTMLAnchorElement>, hash: string) => {
    const el = document.querySelector(hash) as HTMLElement | null
    if (!el) return
    e.preventDefault()
    if (document.querySelector('.silk-canvas')) {
      window.dispatchEvent(new CustomEvent('nav-goto', { detail: hash }))
      return
    }
    const y = el.getBoundingClientRect().top + window.scrollY
    const lenis = (window as unknown as { __lenis?: Lenis }).__lenis
    if (lenis) lenis.scrollTo(y)
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <header className={`site-nav${scrolled ? ' is-scrolled' : ''}${hidden ? ' is-hidden' : ''}${overVideo ? ' is-over-video' : ''}`}>
      <div className="site-nav-bg" aria-hidden="true" />
      <div className="site-nav-inner">
        <NavLogo />
        <nav className="site-nav-links" aria-label="Primary">
          <Link href="/services">Services</Link>
          <Link href="/about">About</Link>
          <a href="#contact" onClick={e => handleAnchor(e, '#contact')}>Contact</a>
        </nav>
        <a
          href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
          target="_blank"
          rel="noreferrer noopener"
          className="site-nav-cta"
        >
          Book a strategy call
        </a>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Add `.site-nav-cta` CSS to globals.css**

Append to `app/globals.css`:

```css
/* ─── SiteNav CTA pill ──────────────────────────────────────── */
.site-nav-cta {
  display: none;
  align-items: center;
  padding: 0.45rem 1.1rem;
  border: 1px solid rgba(255,255,255,0.35);
  border-radius: 999px;
  font-size: 0.78rem;
  font-family: var(--sans);
  letter-spacing: 0.02em;
  color: #fff;
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.2s, border-color 0.2s;
}
.site-nav-cta:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.6);
}
@media (min-width: 768px) {
  .site-nav-cta { display: flex; }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Start dev server and check nav**

```bash
npm run dev
```
Open `http://localhost:3000`. Verify:
- Logo appears top-left
- "Services / About / Contact" links in centre
- "Book a strategy call" pill appears on desktop
- Nav hides on scroll down, reappears on scroll up

- [ ] **Step 5: Commit**

```bash
git add app/components/SiteNav.tsx app/globals.css
git commit -m "feat: add page links and CTA pill to SiteNav"
```

---

## Task 2: HomeVideoHero

**Files:**
- Create: `app/components/home/HomeVideoHero.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeVideoHero />` — no props

- [ ] **Step 1: Create the component**

```bash
mkdir -p app/components/home
```

Create `app/components/home/HomeVideoHero.tsx`:

```tsx
'use client'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function HomeVideoHero() {
  const scrollToSolution = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const el = document.getElementById('solution')
    if (!el) return
    const lenis = (window as unknown as { __lenis?: { scrollTo: (y: number) => void } }).__lenis
    const y = el.getBoundingClientRect().top + window.scrollY
    if (lenis) lenis.scrollTo(y)
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <section className="hvh">
      <video
        className="hvh-video"
        src="https://stabondar.b-cdn.net/ciridae/hero_web.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
      <div className="hvh-overlay" aria-hidden="true" />
      <div className="filmhero-grain" aria-hidden="true" />

      <div className="hvh-content">
        <p className="hvh-tag">· MD MEDIA MARKETING ·</p>
        <h1 className="hvh-headline">
          You&rsquo;re the best-kept secret<br />
          in your market.<br />
          Let&rsquo;s fix that.
        </h1>
        <div className="hvh-actions">
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="hvh-btn hvh-btn--fill"
          >
            Book a strategy call
          </a>
          <a href="#solution" onClick={scrollToSolution} className="hvh-btn hvh-btn--outline">
            See how we work
          </a>
        </div>
      </div>

      <div className="hvh-scroll-hint" aria-hidden="true">
        <span />
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS to globals.css**

Append:

```css
/* ─── HomeVideoHero ─────────────────────────────────────────── */
.hvh {
  position: relative;
  width: 100%;
  height: 100dvh;
  min-height: 600px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
}
.hvh-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.hvh-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to bottom,
    rgba(0,0,0,0.35) 0%,
    rgba(0,0,0,0.2) 50%,
    rgba(0,0,0,0.65) 100%
  );
}
.hvh-content {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 0 1.5rem;
  max-width: 860px;
}
.hvh-tag {
  font-family: var(--sans);
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  margin-bottom: 1.5rem;
}
.hvh-headline {
  font-family: var(--sans);
  font-size: clamp(2.4rem, 6vw, 5.2rem);
  font-weight: 700;
  line-height: 1.08;
  letter-spacing: -0.02em;
  color: #fff;
  margin-bottom: 2.5rem;
}
.hvh-actions {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
}
.hvh-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.75rem 1.75rem;
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 0.88rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-decoration: none;
  transition: all 0.2s;
  white-space: nowrap;
}
.hvh-btn--fill {
  background: #fff;
  color: #0a0a0a;
  border: 1px solid #fff;
}
.hvh-btn--fill:hover { background: rgba(255,255,255,0.88); }
.hvh-btn--outline {
  background: transparent;
  color: #fff;
  border: 1px solid rgba(255,255,255,0.4);
}
.hvh-btn--outline:hover { border-color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.06); }

.hvh-scroll-hint {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
}
.hvh-scroll-hint span {
  display: block;
  width: 1px;
  height: 52px;
  background: linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.5));
  animation: hvh-scroll-line 1.8s ease-in-out infinite;
}
@keyframes hvh-scroll-line {
  0%   { transform: scaleY(0); transform-origin: top; }
  50%  { transform: scaleY(1); transform-origin: top; }
  50.01% { transform-origin: bottom; }
  100% { transform: scaleY(0); transform-origin: bottom; }
}
```

- [ ] **Step 3: Smoke-test in page.tsx**

Temporarily add `HomeVideoHero` to `app/page.tsx` at the top of the return to confirm it renders (revert after):

```tsx
import HomeVideoHero from './components/home/HomeVideoHero'
// add <HomeVideoHero /> at top of return
```

Run `npm run dev`. Open `http://localhost:3000`. Verify video plays fullscreen, headline is centred, both pill buttons appear.

- [ ] **Step 4: Remove the temp import from page.tsx (revert)**

- [ ] **Step 5: Commit**

```bash
git add app/components/home/HomeVideoHero.tsx app/globals.css
git commit -m "feat: add HomeVideoHero component"
```

---

## Task 3: HomeLogoStrip

**Files:**
- Create: `app/components/home/HomeLogoStrip.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeLogoStrip />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeLogoStrip.tsx`:

```tsx
const logos = [
  'c5a69a_a57a94655c1d465581b0d60a633269da~mv2.png',
  'c5a69a_c1d2c702bc7a47c0a3670eaf449e48f8~mv2.png',
  'c5a69a_1ff2bb6a1aaa41ff85948094bae68cb6~mv2.png',
  'c5a69a_9f973b4c457441ea827b9c101d3b74e8~mv2.png',
  'c5a69a_9c826734acc646eb846219ac76393853~mv2.png',
  'c5a69a_9b50e5225f7243b5ad1c7826ac414bcc~mv2.png',
  'c5a69a_7785ca4f44ec4f09bcdb8ca0b0861852~mv2.png',
  'c5a69a_29646c60053a4060993c481b10aed67e~mv2.png',
  'c5a69a_ea64382bc50b443f86001d4febdb8746~mv2.png',
  'c5a69a_f2608dab4cc646c2864fa1f501217e59~mv2.png',
  'c5a69a_67b4f93fb988428b93425a6de9e7b2c4~mv2.png',
  'c5a69a_1664d27fee9744c48a2863b6b9e20ed7~mv2.png',
  'c5a69a_76c36272f9ef485d99928b7faed5cc1a~mv2.png',
]

export default function HomeLogoStrip() {
  const doubled = [...logos, ...logos]
  return (
    <div className="hls" aria-label="Clients and partners">
      <div className="hls-track">
        {doubled.map((logo, i) => (
          <div key={i} className="hls-item">
            <img
              src={`https://static.wixstatic.com/media/${logo}/v1/fit/w_213,h_90,q_90,enc_avif,quality_auto/${logo}`}
              alt=""
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeLogoStrip ─────────────────────────────────────────── */
.hls {
  width: 100%;
  overflow: hidden;
  background: #0a0a0a;
  border-top: 1px solid rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 1.4rem 0;
}
.hls-track {
  display: flex;
  gap: 2.5rem;
  width: max-content;
  animation: hls-scroll 32s linear infinite;
}
.hls:hover .hls-track { animation-play-state: paused; }
.hls-item {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 38px;
  opacity: 0.45;
  filter: brightness(0) invert(1);
  transition: opacity 0.2s;
}
.hls-item:hover { opacity: 0.75; }
.hls-item img { height: 100%; width: auto; object-fit: contain; }
@keyframes hls-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeLogoStrip.tsx app/globals.css
git commit -m "feat: add HomeLogoStrip component"
```

---

## Task 4: HomeProblem

**Files:**
- Create: `app/components/home/HomeProblem.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeProblem />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeProblem.tsx`:

```tsx
export default function HomeProblem() {
  return (
    <section className="hprob">
      <p className="hprob-label">· THE PROBLEM ·</p>
      <h2 className="hprob-heading">
        Great businesses go<br />unseen every day.
      </h2>
      <p className="hprob-body">
        You&rsquo;re brilliant at what you do. Your clients love you.<br className="hprob-br" />
        But online? You&rsquo;re quiet.
      </p>
      <p className="hprob-body">
        Maybe you post when you remember to. Maybe you&rsquo;ve tried an agency that flooded your feed
        with content that didn&rsquo;t sound like you — or sold you a strategy deck
        that&rsquo;s still sitting in a folder.
      </p>
      <p className="hprob-body hprob-body--em">
        The result is the same: the people who should be hiring you don&rsquo;t know you exist.
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeProblem ───────────────────────────────────────────── */
.hprob {
  min-height: 100dvh;
  background: #000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 6rem 1.5rem;
  gap: 1.5rem;
}
.hprob-label {
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
}
.hprob-heading {
  font-family: var(--sans);
  font-size: clamp(2.4rem, 6vw, 5rem);
  font-weight: 700;
  line-height: 1.05;
  letter-spacing: -0.025em;
  color: #fff;
  max-width: 16ch;
}
.hprob-body {
  font-family: var(--sans);
  font-size: clamp(0.95rem, 1.5vw, 1.15rem);
  line-height: 1.7;
  color: rgba(255,255,255,0.55);
  max-width: 52ch;
}
.hprob-body--em { color: rgba(255,255,255,0.8); }
.hprob-br { display: none; }
@media (min-width: 768px) { .hprob-br { display: block; } }
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeProblem.tsx app/globals.css
git commit -m "feat: add HomeProblem section"
```

---

## Task 5: HomeSolution

**Files:**
- Create: `app/components/home/HomeSolution.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeSolution />` — no props; renders with `id="solution"` (scroll target from hero CTA)

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeSolution.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'

const cards = [
  {
    num: '01',
    title: 'Content First',
    body: 'We start with visibility — content built around you, your story, and your offer — so you start showing up where your customers already are.',
    icon: '✦',
  },
  {
    num: '02',
    title: 'Scale Into It',
    body: 'As it works, we scale: paid advertising to put fuel behind it, a full brand to make it look the part, and strategy to tie it all together.',
    icon: '◈',
  },
  {
    num: '03',
    title: 'One Team',
    body: "You get a marketing partner who grows with you — not five separate freelancers you have to manage.",
    icon: '⬡',
  },
]

export default function HomeSolution() {
  const bgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bg = bgRef.current
    if (!bg) return

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!bg) return
        const rect = bg.parentElement!.getBoundingClientRect()
        const offset = -rect.top * 0.3
        bg.style.transform = `translateY(${offset}px)`
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section className="hsol" id="solution">
      <div className="hsol-bg" ref={bgRef} aria-hidden="true" />
      <div className="hsol-inner">
        <p className="hsol-label">· THE SOLUTION ·</p>
        <h2 className="hsol-heading">One team. Content first.<br />Everything you need next.</h2>
        <div className="hsol-cards">
          {cards.map((c) => (
            <div className="hsol-card" key={c.num}>
              <span className="hsol-card-num">{c.num}</span>
              <p className="hsol-card-title">{c.title}</p>
              <p className="hsol-card-body">{c.body}</p>
              <span className="hsol-card-icon" aria-hidden="true">{c.icon}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeSolution ──────────────────────────────────────────── */
.hsol {
  position: relative;
  overflow: hidden;
  padding: 8rem 1.5rem;
  background: #0a0a0a;
}
.hsol-bg {
  position: absolute;
  inset: -20%;
  background-image: url('https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1600&q=60');
  background-size: cover;
  background-position: center;
  opacity: 0.18;
  will-change: transform;
}
.hsol-inner {
  position: relative;
  z-index: 1;
  max-width: 1100px;
  margin: 0 auto;
  text-align: center;
}
.hsol-label {
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  margin-bottom: 1.25rem;
}
.hsol-heading {
  font-family: var(--sans);
  font-size: clamp(2rem, 4.5vw, 3.8rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: #fff;
  margin-bottom: 4rem;
}
.hsol-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 768px) {
  .hsol-cards { grid-template-columns: repeat(3, 1fr); }
}
.hsol-card {
  position: relative;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px;
  padding: 2rem 1.75rem 2.5rem;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  transition: border-color 0.25s, background 0.25s;
}
.hsol-card:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.2);
}
.hsol-card-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.5);
  align-self: flex-start;
}
.hsol-card-title {
  font-family: var(--sans);
  font-size: 1.15rem;
  font-weight: 600;
  color: #fff;
}
.hsol-card-body {
  font-family: var(--sans);
  font-size: 0.9rem;
  line-height: 1.65;
  color: rgba(255,255,255,0.55);
  flex: 1;
}
.hsol-card-icon {
  font-size: 1.5rem;
  color: rgba(255,255,255,0.2);
  align-self: flex-end;
  margin-top: 1rem;
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeSolution.tsx app/globals.css
git commit -m "feat: add HomeSolution parallax + glassmorphism cards"
```

---

## Task 6: HomeServices

**Files:**
- Create: `app/components/home/HomeServices.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeServices />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeServices.tsx`:

```tsx
'use client'

import { useState } from 'react'

const services = [
  {
    num: '01',
    title: 'Content\n& Visibility',
    body: 'Photo, video, and social content built around you — so you look established, sound like yourself, and stay consistent without lifting a finger.',
    img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=70',
    href: '/content',
  },
  {
    num: '02',
    title: 'Paid\nAdvertising',
    body: 'Meta, Google, and more — campaigns that turn attention into enquiries, with the numbers to prove it.',
    img: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=70',
    href: '/services',
  },
  {
    num: '03',
    title: 'Branding\nSuite',
    body: 'Logo, identity, messaging, and the full visual system that makes you look like the business you\'re becoming.',
    img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=70',
    href: '/branding',
  },
  {
    num: '04',
    title: 'Strategy\n& Consulting',
    body: 'The plan behind the work — positioning, offers, and a clear path from "no one knows us" to "we can\'t keep up."',
    img: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=70',
    href: '/services',
  },
]

export default function HomeServices() {
  const [active, setActive] = useState<number | null>(null)

  return (
    <section className="hsvc">
      <div className="hsvc-header">
        <p className="hsvc-label">· WHAT WE DO ·</p>
        <h2 className="hsvc-heading">Start with content.<br />Scale into the rest.</h2>
      </div>
      <div className="hsvc-panels">
        {services.map((s, i) => (
          <a
            key={i}
            href={s.href}
            className={`hsvc-panel${active === i ? ' hsvc-panel--active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <img src={s.img} alt="" className="hsvc-panel-img" loading="lazy" />
            <div className="hsvc-panel-overlay" aria-hidden="true" />
            <div className="hsvc-panel-content">
              <span className="hsvc-panel-num">{s.num}</span>
              <p className="hsvc-panel-title">
                {s.title.split('\n').map((line, j) => (
                  <span key={j}>{line}<br /></span>
                ))}
              </p>
              <p className="hsvc-panel-body">{s.body}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeServices ──────────────────────────────────────────── */
.hsvc {
  background: #000;
  padding: 6rem 0 0;
}
.hsvc-header {
  text-align: center;
  padding: 0 1.5rem 4rem;
}
.hsvc-label {
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  margin-bottom: 1.25rem;
}
.hsvc-heading {
  font-family: var(--sans);
  font-size: clamp(2rem, 4.5vw, 3.8rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: #fff;
}
.hsvc-panels {
  display: flex;
  height: 70vh;
  min-height: 480px;
}
@media (max-width: 767px) {
  .hsvc-panels {
    flex-direction: column;
    height: auto;
  }
}
.hsvc-panel {
  position: relative;
  flex: 1;
  overflow: hidden;
  cursor: pointer;
  text-decoration: none;
  transition: flex 0.5s cubic-bezier(0.4,0,0.2,1);
  border-right: 1px solid rgba(255,255,255,0.06);
}
.hsvc-panel:last-child { border-right: none; }
.hsvc-panel--active { flex: 3; }
@media (max-width: 767px) {
  .hsvc-panel { flex: none; height: 220px; }
  .hsvc-panel--active { height: 340px; }
}
.hsvc-panel-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.6s cubic-bezier(0.4,0,0.2,1), opacity 0.3s;
}
.hsvc-panel--active .hsvc-panel-img { transform: scale(1.04); }
.hsvc-panel-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.3) 60%, rgba(0,0,0,0.1) 100%);
}
.hsvc-panel-content {
  position: absolute;
  inset: 0;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.5rem;
}
.hsvc-panel-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.9rem;
  height: 1.9rem;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 0.65rem;
  letter-spacing: 0.06em;
  color: rgba(255,255,255,0.6);
  margin-bottom: 0.5rem;
  align-self: flex-start;
}
.hsvc-panel-title {
  font-family: var(--sans);
  font-size: clamp(1rem, 1.4vw, 1.25rem);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #fff;
  line-height: 1.2;
}
.hsvc-panel-body {
  font-family: var(--sans);
  font-size: 0.85rem;
  line-height: 1.6;
  color: rgba(255,255,255,0.7);
  max-width: 28ch;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 0.3s 0.15s, transform 0.3s 0.15s;
}
.hsvc-panel--active .hsvc-panel-body {
  opacity: 1;
  transform: translateY(0);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeServices.tsx app/globals.css
git commit -m "feat: add HomeServices image panel section"
```

---

## Task 7: HomeHowItWorks

**Files:**
- Create: `app/components/home/HomeHowItWorks.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeHowItWorks />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeHowItWorks.tsx`:

```tsx
const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const steps = [
  {
    num: '01',
    title: 'Strategy call',
    body: "We get clear on your business, your goals, and where the gaps are. No pitch deck, no jargon — just a plan.",
  },
  {
    num: '02',
    title: 'We build your visibility',
    body: "We create the content and assets that get you seen, and we handle the moving parts so you can stay in your zone.",
  },
  {
    num: '03',
    title: 'We scale what works',
    body: "Once you're showing up, we add paid, brand, and strategy to turn attention into a steady flow of customers.",
  },
]

export default function HomeHowItWorks() {
  return (
    <section className="hhiw">
      <div className="hhiw-inner">
        <div className="hhiw-header">
          <p className="hhiw-label">· HOW IT WORKS ·</p>
          <h2 className="hhiw-heading">From invisible to in-demand,<br />in three steps.</h2>
        </div>
        <div className="hhiw-steps">
          {steps.map((s) => (
            <div className="hhiw-step" key={s.num}>
              <span className="hhiw-step-num">{s.num}</span>
              <div className="hhiw-step-text">
                <h3 className="hhiw-step-title">{s.title}</h3>
                <p className="hhiw-step-body">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
        <a
          href={CALENDLY}
          target="_blank"
          rel="noreferrer noopener"
          className="hhiw-cta"
        >
          Book your strategy call
        </a>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeHowItWorks ────────────────────────────────────────── */
.hhiw {
  background: #0a0a0a;
  padding: 8rem 1.5rem;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.hhiw-inner {
  max-width: 860px;
  margin: 0 auto;
}
.hhiw-header {
  margin-bottom: 4rem;
}
.hhiw-label {
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  margin-bottom: 1.25rem;
}
.hhiw-heading {
  font-family: var(--sans);
  font-size: clamp(2rem, 4vw, 3.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: #fff;
}
.hhiw-steps {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.hhiw-step {
  display: grid;
  grid-template-columns: 5rem 1fr;
  gap: 1.5rem;
  padding: 2.5rem 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  align-items: start;
}
.hhiw-step:first-child { border-top: 1px solid rgba(255,255,255,0.08); }
.hhiw-step-num {
  font-family: var(--sans);
  font-size: clamp(2.2rem, 4vw, 3.5rem);
  font-weight: 700;
  color: rgba(255,255,255,0.1);
  letter-spacing: -0.04em;
  line-height: 1;
}
.hhiw-step-title {
  font-family: var(--sans);
  font-size: clamp(1.1rem, 2vw, 1.4rem);
  font-weight: 600;
  color: #fff;
  margin-bottom: 0.6rem;
}
.hhiw-step-body {
  font-family: var(--sans);
  font-size: 0.95rem;
  line-height: 1.7;
  color: rgba(255,255,255,0.55);
}
.hhiw-cta {
  display: inline-flex;
  margin-top: 3rem;
  padding: 0.8rem 2rem;
  border: 1px solid rgba(255,255,255,0.3);
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 0.88rem;
  color: #fff;
  text-decoration: none;
  letter-spacing: 0.02em;
  transition: all 0.2s;
}
.hhiw-cta:hover {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.6);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeHowItWorks.tsx app/globals.css
git commit -m "feat: add HomeHowItWorks section"
```

---

## Task 8: HomeWhyUs

**Files:**
- Create: `app/components/home/HomeWhyUs.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeWhyUs />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeWhyUs.tsx`:

```tsx
const reasons = [
  {
    title: 'Content-led, not content-only',
    body: 'We make you visible first, then build the strategy and systems behind it.',
  },
  {
    title: 'One partner, end-to-end',
    body: 'Content, paid, brand, and strategy under one roof — no juggling vendors.',
  },
  {
    title: 'Built around you',
    body: "Your content sounds like you and looks like you, not a template.",
  },
  {
    title: 'We grow at your pace',
    body: "Start small, scale when it's working. No bloated retainers for things you don't need yet.",
  },
]

export default function HomeWhyUs() {
  return (
    <section className="hwhy">
      <div className="hwhy-inner">
        <p className="hwhy-label">· WHY MD MEDIA ·</p>
        <h2 className="hwhy-heading">Why founders and local<br />businesses choose us.</h2>
        <div className="hwhy-grid">
          {reasons.map((r, i) => (
            <div className="hwhy-card" key={i}>
              <h3 className="hwhy-card-title">{r.title}</h3>
              <p className="hwhy-card-body">{r.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeWhyUs ─────────────────────────────────────────────── */
.hwhy {
  background: #0a0a0a;
  padding: 8rem 1.5rem;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.hwhy-inner {
  max-width: 1100px;
  margin: 0 auto;
}
.hwhy-label {
  font-family: var(--sans);
  font-size: 0.7rem;
  letter-spacing: 0.2em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  margin-bottom: 1.25rem;
}
.hwhy-heading {
  font-family: var(--sans);
  font-size: clamp(2rem, 4vw, 3.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.1;
  color: #fff;
  margin-bottom: 3.5rem;
}
.hwhy-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 600px)  { .hwhy-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .hwhy-grid { grid-template-columns: repeat(4, 1fr); } }
.hwhy-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.09);
  border-radius: 16px;
  padding: 2rem 1.75rem;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.25s, border-color 0.25s;
}
.hwhy-card:hover {
  background: rgba(255,255,255,0.07);
  border-color: rgba(255,255,255,0.18);
}
.hwhy-card-title {
  font-family: var(--sans);
  font-size: 1rem;
  font-weight: 600;
  color: #fff;
  margin-bottom: 0.75rem;
  line-height: 1.3;
}
.hwhy-card-body {
  font-family: var(--sans);
  font-size: 0.88rem;
  line-height: 1.65;
  color: rgba(255,255,255,0.5);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeWhyUs.tsx app/globals.css
git commit -m "feat: add HomeWhyUs glassmorphism grid"
```

---

## Task 9: HomeTestimonial

**Files:**
- Create: `app/components/home/HomeTestimonial.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeTestimonial />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeTestimonial.tsx`:

```tsx
export default function HomeTestimonial() {
  return (
    <section className="htesti">
      <div className="htesti-inner">
        <p className="htesti-quote">
          &ldquo;[Specific result in the client&rsquo;s words — what changed in enquiries, bookings, or confidence since working with MD Media.]&rdquo;
        </p>
        <hr className="htesti-rule" />
        <p className="htesti-attr">[Client name] &mdash; [Business], [Location]</p>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeTestimonial ───────────────────────────────────────── */
.htesti {
  background: #000;
  padding: 8rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.htesti-inner {
  max-width: 720px;
  text-align: center;
}
.htesti-quote {
  font-family: var(--sans);
  font-size: clamp(1.15rem, 2.5vw, 1.6rem);
  font-style: italic;
  font-weight: 300;
  line-height: 1.55;
  color: rgba(255,255,255,0.85);
  margin-bottom: 2rem;
}
.htesti-rule {
  border: none;
  border-top: 1px solid rgba(255,255,255,0.12);
  margin-bottom: 1.5rem;
}
.htesti-attr {
  font-family: var(--sans);
  font-size: 0.8rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.35);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeTestimonial.tsx app/globals.css
git commit -m "feat: add HomeTestimonial section"
```

---

## Task 10: HomeCtaBanner

**Files:**
- Create: `app/components/home/HomeCtaBanner.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `<HomeCtaBanner />` — no props

- [ ] **Step 1: Create the component**

Create `app/components/home/HomeCtaBanner.tsx`:

```tsx
const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function HomeCtaBanner() {
  return (
    <section className="hcta">
      <div className="hcta-blobs" aria-hidden="true">
        <span className="hcta-blob hcta-blob--blue" />
        <span className="hcta-blob hcta-blob--teal" />
        <span className="hcta-blob hcta-blob--dark" />
      </div>
      <div className="hcta-overlay" aria-hidden="true" />
      <div className="hcta-content">
        <h2 className="hcta-heading">
          Ready to stop being<br />the best-kept secret?
        </h2>
        <p className="hcta-body">
          Book a free strategy call. We&rsquo;ll look at where you&rsquo;re invisible, where the
          opportunity is, and exactly what we&rsquo;d do first. No obligation, no hard sell.
        </p>
        <a
          href={CALENDLY}
          target="_blank"
          rel="noreferrer noopener"
          className="hcta-btn"
        >
          Book a strategy call
        </a>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Add CSS**

Append to `app/globals.css`:

```css
/* ─── HomeCtaBanner ─────────────────────────────────────────── */
.hcta {
  position: relative;
  overflow: hidden;
  background: #000;
  padding: 10rem 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hcta-blobs {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.hcta-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
}
.hcta-blob--blue {
  width: 50vw;
  height: 50vw;
  background: #1a4a8a;
  top: -10%;
  left: -10%;
  opacity: 0.4;
}
.hcta-blob--teal {
  width: 40vw;
  height: 40vw;
  background: #0d4a40;
  bottom: -10%;
  right: 5%;
  opacity: 0.35;
}
.hcta-blob--dark {
  width: 60vw;
  height: 60vw;
  background: #000;
  top: 20%;
  left: 20%;
  opacity: 0.7;
}
.hcta-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.7) 100%);
}
.hcta-content {
  position: relative;
  z-index: 1;
  text-align: center;
  max-width: 640px;
}
.hcta-heading {
  font-family: var(--sans);
  font-size: clamp(2.2rem, 5vw, 4.2rem);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.08;
  color: #fff;
  margin-bottom: 1.5rem;
}
.hcta-body {
  font-family: var(--sans);
  font-size: clamp(0.95rem, 1.5vw, 1.1rem);
  line-height: 1.7;
  color: rgba(255,255,255,0.6);
  margin-bottom: 2.5rem;
}
.hcta-btn {
  display: inline-flex;
  align-items: center;
  padding: 0.9rem 2.25rem;
  background: #fff;
  color: #0a0a0a;
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 0.9rem;
  font-weight: 600;
  text-decoration: none;
  letter-spacing: 0.02em;
  transition: all 0.2s;
}
.hcta-btn:hover {
  background: rgba(255,255,255,0.88);
  transform: translateY(-1px);
}
```

- [ ] **Step 3: Commit**

```bash
git add app/components/home/HomeCtaBanner.tsx app/globals.css
git commit -m "feat: add HomeCtaBanner with colour-blob ambient background"
```

---

## Task 11: Wire up app/page.tsx

**Files:**
- Modify: `app/page.tsx` — replace entirely

**Interfaces:**
- Consumes: all 9 `home/` components + `SiteNav` + `SiteFooter`

- [ ] **Step 1: Replace app/page.tsx**

Replace the entire content of `app/page.tsx`:

```tsx
import type { Metadata } from 'next'
import SiteNav from './components/SiteNav'
import HomeVideoHero from './components/home/HomeVideoHero'
import HomeLogoStrip from './components/home/HomeLogoStrip'
import HomeProblem from './components/home/HomeProblem'
import HomeSolution from './components/home/HomeSolution'
import HomeServices from './components/home/HomeServices'
import HomeHowItWorks from './components/home/HomeHowItWorks'
import HomeWhyUs from './components/home/HomeWhyUs'
import HomeTestimonial from './components/home/HomeTestimonial'
import HomeCtaBanner from './components/home/HomeCtaBanner'
import SiteFooter from './components/SiteFooter'

export const metadata: Metadata = {
  title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
  description: 'MD Media helps founders and local businesses get seen, known, and booked. Content-led marketing, plus paid ads, branding, and strategy. Book a strategy call.',
  keywords: 'Melbourne marketing agency, content marketing, personal brand, local business marketing, MD Media',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/',
    title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
    description: 'Content-led marketing for founders and local businesses. Book a strategy call.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
    description: 'Content-led marketing for founders and local businesses. Book a strategy call.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main>
        <HomeVideoHero />
        <HomeLogoStrip />
        <HomeProblem />
        <HomeSolution />
        <HomeServices />
        <HomeHowItWorks />
        <HomeWhyUs />
        <HomeTestimonial />
        <HomeCtaBanner />
      </main>
      <SiteFooter vol="Vol. 03 // MD Media" tagline={<>Strategy. Content. Distribution.<br />Built for founders and local businesses ready to stop blending in.</>} />
    </>
  )
}
```

- [ ] **Step 2: Check SiteFooter props**

Open `app/components/SiteFooter.tsx` and confirm it accepts `vol` and `tagline` props (it's used on `/marketing` with those props, so it does). No changes needed.

- [ ] **Step 3: Build check**

```bash
npx tsc --noEmit
npm run build
```
Expected: build succeeds with no type errors.

- [ ] **Step 4: Full visual QA in dev**

```bash
npm run dev
```

Open `http://localhost:3000` and check each section:
1. Video hero fills viewport, headline readable, both buttons work
2. Logo strip scrolls
3. Problem screen fills viewport on black
4. Solution cards have blur/glass effect with parallax bg
5. Services panels expand on hover, all 4 images load
6. How it works steps have large faded numbers
7. Why us 2×2 grid on desktop (stacks on mobile)
8. Testimonial centred on black
9. CTA banner has colour blobs, white button
10. Footer renders correctly
11. Nav: fixed, links correct, CTA pill visible on desktop

Check mobile (375px): all sections stack correctly, no overflow.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: launch new MD Media homepage"
```

---

## Self-Review

**Spec coverage:**
- ✅ Video hero (`HomeVideoHero`)
- ✅ Logo strip (`HomeLogoStrip`)
- ✅ Problem section (`HomeProblem`)
- ✅ Solution / glassmorphism cards (`HomeSolution`) — `id="solution"` for scroll target
- ✅ Services panels with hover expand (`HomeServices`)
- ✅ How it works (`HomeHowItWorks`)
- ✅ Why us grid (`HomeWhyUs`)
- ✅ Testimonial (`HomeTestimonial`)
- ✅ CTA banner with colour blobs (`HomeCtaBanner`)
- ✅ SiteNav updated with page links + pill CTA
- ✅ Existing components untouched
- ✅ globals.css additive only

**Placeholder scan:** No TBDs. All testimonial/bracket copy preserved as-is per spec.

**Type consistency:**
- `CALENDLY` constant defined locally in the two components that need it (Tasks 7, 10) — same URL string, no shared import needed
- `SiteFooter` props (`vol`, `tagline`) match existing usage in `/marketing/page.tsx`
- All component names match their import paths in Task 11
