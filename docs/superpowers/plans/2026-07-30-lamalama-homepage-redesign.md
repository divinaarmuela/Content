# Lama-Lama-Style Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/` in the Lama Lama visual language (charcoal dotted texture, huge cream uppercase headlines, monospace micro-labels, scramble-on-scroll text, preloader, contextual nav pill, bottom metadata bar) using MD Media's existing copy and client data.

**Architecture:** New self-contained component set in `app/components/lama/`, styled entirely with Tailwind utilities (tokens/keyframes added to `tailwind.config.js`). Scroll effects via one custom scramble hook + IntersectionObserver. `app/page.tsx` is replaced; every existing component stays on disk untouched.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 3.4 (already installed, `preflight: false`), `next/font/google`. **No new dependencies.**

## Global Constraints

- Colors: background `#1a1c1c`, text `#f9f4eb`, secondary text `rgba(249,244,235,0.65)`, accent `#298dff`.
- Fonts: headings/body **Archivo**, mono **Sometype Mono**, both via `next/font/google`. Never reference Suisse or any Lama Lama asset.
- Headlines: Archivo 700, `uppercase`, `line-height: 0.8`, `letter-spacing: -0.02em`.
- Styling: Tailwind utilities only; no new `.css` files; `globals.css` untouched. Keyframes/tokens live in `tailwind.config.js`.
- Copy: MD Media's existing homepage copy verbatim (given inline in tasks). Never invent new marketing claims.
- Calendly URL everywhere: `https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone`
- Socials: Instagram `https://www.instagram.com/mdmedia._`, LinkedIn `https://www.linkedin.com/company/mdmedia-marketing/`
- All animation respects `prefers-reduced-motion` (render final state, no loops).
- Do NOT modify: `app/components/home/*`, `SiteNav.tsx`, `SiteFooter.tsx`, `app/globals.css`, any other route.
- No test framework exists in this repo. Each task's verify step is `npm run build` (must pass with zero type errors) plus, where stated, a visual check via `npm run dev`.
- Commit after every task.

---

### Task 1: Design tokens + fonts

**Files:**
- Modify: `tailwind.config.js`
- Create: `app/components/lama/fonts.ts`

**Interfaces:**
- Produces: Tailwind classes `bg-ink`, `text-cream`, `text-cream-dim`, `text-accent`, `font-lamah`, `font-lamam`, `animate-lama-marquee`, `bg-lama-dots`; exports `archivo`, `sometype` (NextFont objects with `.variable`).

- [ ] **Step 1: Extend tailwind.config.js** (replace `theme.extend` only; keep `content`, `corePlugins` as-is)

```js
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Tight"', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Courier New"', 'monospace'],
        lamah: ['var(--font-archivo)', 'Helvetica', 'Arial', 'sans-serif'],
        lamam: ['var(--font-sometype)', '"Courier New"', 'monospace'],
      },
      colors: {
        ink: '#1a1c1c',
        cream: { DEFAULT: '#f9f4eb', dim: 'rgba(249,244,235,0.65)', faint: 'rgba(249,244,235,0.25)' },
        accent: '#298dff',
      },
      backgroundImage: {
        'lama-dots': 'radial-gradient(rgba(249,244,235,0.07) 1px, transparent 1px)',
      },
      keyframes: {
        'lama-marquee': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'lama-marquee': 'lama-marquee 40s linear infinite',
      },
    },
  },
```

- [ ] **Step 2: Create `app/components/lama/fonts.ts`**

```ts
import { Archivo, Sometype_Mono } from 'next/font/google'

export const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-archivo',
  display: 'swap',
})

export const sometype = Sometype_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-sometype',
  display: 'swap',
})
```

- [ ] **Step 3: Verify** — Run `npm run build`. Expected: passes (fonts not referenced anywhere yet is fine).

- [ ] **Step 4: Commit** — `git add tailwind.config.js app/components/lama/fonts.ts && git commit -m "feat(lama): add design tokens and fonts for homepage redesign"`

---

### Task 2: Shared work data

**Files:**
- Create: `app/components/lama/workData.ts`
- Modify: `app/work/page.tsx` (lines 1–62: delete the inline `clients` array, add import)

**Interfaces:**
- Produces: `export type WorkClient = { name: string; industry: string; services: string[]; desc: string; img: string; tag: string; result?: string }`, `export const clients: WorkClient[]` (the 7 existing clients, values copied **verbatim** from `app/work/page.tsx`), `export const wixImg = (id: string, w: number, h: number) => string`.

- [ ] **Step 1: Create `app/components/lama/workData.ts`** — move the entire `clients` array currently at `app/work/page.tsx:3-62` into it unchanged, typed as above, plus:

```ts
export const wixImg = (id: string, w: number, h: number) =>
  `https://static.wixstatic.com/media/${id}/v1/fill/w_${w},h_${h},al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${id}`
```

- [ ] **Step 2: Update `app/work/page.tsx`** — delete its inline array; add `import { clients } from '../components/lama/workData'`. No other change; markup untouched.

- [ ] **Step 3: Verify** — `npm run build` passes. Load `/work` in dev and confirm it renders identically (7 cards, images load).

- [ ] **Step 4: Commit** — `git add app/components/lama/workData.ts app/work/page.tsx && git commit -m "refactor: extract work client data to shared module"`

---

### Task 3: Scramble hook + reveal component

**Files:**
- Create: `app/components/lama/Scramble.tsx`
- Create: `app/components/lama/Reveal.tsx`

**Interfaces:**
- Produces:
  - `useScramble(text: string, opts?: { play?: boolean; duration?: number }): string` — returns the currently-displayed string; animates from glitch chars to `text` when `play` flips true.
  - `<Scramble text className as delay />` — renders an element (`as` default `'span'`) that scrambles in when it enters the viewport. Props: `text: string`, `className?: string`, `as?: 'span'|'p'|'div'`, `delay?: number` (ms).
  - `<Reveal className children delay />` — wrapper `div` that fades/translates up (`opacity-0 translate-y-6` → none over 700ms) when it enters the viewport.

- [ ] **Step 1: Create `app/components/lama/Scramble.tsx`**

```tsx
'use client'

import { createElement, useEffect, useRef, useState } from 'react'

const CHARS = '#(_>@%$*+·<)[]'

const prefersReduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function useScramble(text: string, opts?: { play?: boolean; duration?: number }) {
  const { play = true, duration = 900 } = opts ?? {}
  const [display, setDisplay] = useState(() => (prefersReduced() ? text : ''))
  const raf = useRef(0)

  useEffect(() => {
    if (!play) return
    if (prefersReduced()) { setDisplay(text); return }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const settled = Math.floor(t * text.length)
      let out = text.slice(0, settled)
      for (let i = settled; i < text.length; i++) {
        out += text[i] === ' ' ? ' ' : CHARS[Math.floor(Math.random() * CHARS.length)]
      }
      setDisplay(out)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [text, play, duration])

  return display
}

export function Scramble({
  text, className, as = 'span', delay = 0,
}: { text: string; className?: string; as?: 'span' | 'p' | 'div'; delay?: number }) {
  const ref = useRef<HTMLElement>(null)
  const [play, setPlay] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          const id = window.setTimeout(() => setPlay(true), delay)
          io.disconnect()
          return () => window.clearTimeout(id)
        }
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [delay])

  const display = useScramble(text, { play })
  // reserve width with invisible final text to avoid layout shift
  return createElement(
    as,
    { ref, className: `relative inline-block ${className ?? ''}` },
    <>
      <span aria-hidden="true" className="invisible">{text}</span>
      <span className="absolute inset-0">{display}</span>
    </>,
  )
}
```

- [ ] **Step 2: Create `app/components/lama/Reveal.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

export default function Reveal({
  children, className = '', delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(true); return }
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-out ${shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'} ${className}`}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Verify** — `npm run build` passes.

- [ ] **Step 4: Commit** — `git add app/components/lama/Scramble.tsx app/components/lama/Reveal.tsx && git commit -m "feat(lama): add scramble and reveal animation primitives"`

---

### Task 4: Preloader

**Files:**
- Create: `app/components/lama/LamaLoader.tsx`

**Interfaces:**
- Produces: `<LamaLoader />` (client component, self-removing overlay). No props.

- [ ] **Step 1: Create `app/components/lama/LamaLoader.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'

export default function LamaLoader() {
  const [pct, setPct] = useState(0)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setGone(true); return }
    const start = performance.now()
    const DUR = 1500
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / DUR, 1)
      // easeOutCubic so it rushes early, settles at the end
      setPct(Math.round((1 - Math.pow(1 - t, 3)) * 100))
      if (t < 1) raf = requestAnimationFrame(tick)
      else setTimeout(() => setGone(true), 250)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  if (gone) return null
  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[200] flex items-center justify-center bg-black transition-opacity duration-500 ${pct >= 100 ? 'opacity-0' : 'opacity-100'}`}
    >
      <span className="font-lamam text-sm text-cream tracking-widest">{pct}%</span>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaLoader.tsx && git commit -m "feat(lama): add percentage preloader"`

---

### Task 5: Bottom metadata bar

**Files:**
- Create: `app/components/lama/LamaFooterBar.tsx`

**Interfaces:**
- Produces: `<LamaFooterBar />` (client). Fixed bottom strip; hidden below `sm` (640px).

- [ ] **Step 1: Create `app/components/lama/LamaFooterBar.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Scramble } from './Scramble'

function Clock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    <span className="flex items-center gap-1.5">
      [ <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
      {now ? `${p(now.getHours())} : ${p(now.getMinutes())} : ${p(now.getSeconds())}` : '00 : 00 : 00'} ]
    </span>
  )
}

export default function LamaFooterBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-[90] hidden sm:block bg-ink/80 backdrop-blur-sm">
      <div className="border-t border-cream/10 px-6 py-2.5 flex items-center gap-8 font-lamam text-[11px] uppercase tracking-wider text-cream">
        <Scramble text="EST. 2024" />
        <Scramble text="MELBOURNE BASED" />
        <Clock />
        <span className="ml-auto" />
        <Scramble text="FOLLOW US" className="text-cream-dim" />
        <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">INSTAGRAM +</a>
        <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener" className="hover:text-accent transition-colors">LINKEDIN +</a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaFooterBar.tsx && git commit -m "feat(lama): add fixed metadata bar with live clock"`

---

### Task 6: Contextual nav pill + overlay menu

**Files:**
- Create: `app/components/lama/LamaNav.tsx`

**Interfaces:**
- Consumes: sections in the page marked `data-lama-title="SOME TITLE"` (Task 13 adds these).
- Produces: `<LamaNav />` (client). Observes all `[data-lama-title]` elements and shows the title of the one currently in view, re-scrambling on change.

- [ ] **Step 1: Create `app/components/lama/LamaNav.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useScramble } from './Scramble'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const LINKS = [
  { href: '/work', label: 'Work' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]

export default function LamaNav() {
  const [title, setTitle] = useState('MD MEDIA MARKETING')
  const [open, setOpen] = useState(false)
  const display = useScramble(title, { duration: 500 })

  useEffect(() => {
    const sections = document.querySelectorAll<HTMLElement>('[data-lama-title]')
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setTitle(e.target.dataset.lamaTitle!)
        }
      },
      { rootMargin: '-40% 0px -55% 0px' },
    )
    sections.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      <header className="fixed top-4 left-1/2 z-[110] -translate-x-1/2 w-[min(480px,calc(100vw-2rem))]">
        <div className="flex items-center justify-between bg-black px-4 py-3 shadow-lg">
          <Link href="/" aria-label="MD Media home" className="font-lamah font-bold text-cream text-sm leading-none">MD</Link>
          <span className="font-lamam text-[11px] uppercase tracking-widest text-cream">{display}</span>
          <button
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex flex-col gap-1 p-1"
          >
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? 'translate-y-1.5 rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-opacity ${open ? 'opacity-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-cream transition-transform ${open ? '-translate-y-1.5 -rotate-45' : ''}`} />
          </button>
        </div>
      </header>

      {open && (
        <nav className="fixed inset-0 z-[105] bg-black flex flex-col justify-center px-8 sm:px-20">
          {LINKS.map((l, i) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="group flex items-baseline gap-6 py-3 border-b border-cream/10"
            >
              <span className="font-lamam text-xs text-cream-dim">0{i + 1}</span>
              <span className="font-lamah font-bold uppercase text-cream text-[clamp(2rem,7vw,4.5rem)] leading-[0.9] tracking-tight group-hover:text-accent transition-colors">
                {l.label}
              </span>
            </Link>
          ))}
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-10 self-start border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream hover:bg-cream hover:text-ink transition-colors"
          >
            BOOK A STRATEGY CALL ↗
          </a>
        </nav>
      )}
    </>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaNav.tsx && git commit -m "feat(lama): add contextual nav pill with overlay menu"`

---

### Task 7: Hero

**Files:**
- Create: `app/components/lama/LamaHero.tsx`

**Interfaces:**
- Produces: `<LamaHero />` (server component; static markup + Reveal/Scramble children).

- [ ] **Step 1: Create `app/components/lama/LamaHero.tsx`**

```tsx
import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaHero() {
  return (
    <section
      data-lama-title="MD MEDIA MARKETING"
      className="relative min-h-[100dvh] bg-ink bg-lama-dots [background-size:4px_4px] flex flex-col justify-end px-6 sm:px-10 pb-24 pt-40"
    >
      <Scramble text="[ MD MEDIA MARKETING ]" className="absolute top-28 left-6 sm:left-10 font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
      <div className="flex flex-col lg:flex-row lg:items-end gap-10">
        <Reveal className="lg:w-2/3">
          <h1 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
            You&rsquo;re the best-kept secret in your market. Let&rsquo;s fix that.
          </h1>
        </Reveal>
        <Reveal delay={200} className="lg:w-1/3 lg:max-w-xs lg:ml-auto">
          <p className="font-lamah text-cream-dim text-base leading-relaxed">
            Strategy. Content. Distribution. Built for founders and local businesses ready to stop blending in.
          </p>
        </Reveal>
      </div>
      <div className="mt-16 h-px bg-cream/20" />
    </section>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaHero.tsx && git commit -m "feat(lama): add statement hero"`

---

### Task 8: Intro paragraph

**Files:**
- Create: `app/components/lama/LamaIntro.tsx`

- [ ] **Step 1: Create `app/components/lama/LamaIntro.tsx`** (copy is HomeProblem's, merged, verbatim sentences)

```tsx
import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaIntro() {
  return (
    <section data-lama-title="THE PROBLEM" className="bg-ink px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <p className="font-lamah text-cream text-[clamp(1.75rem,3.4vw,2.75rem)] leading-tight max-w-4xl [text-indent:3em]">
          You&rsquo;re brilliant at what you do. Your clients love you. But online? You&rsquo;re quiet.
          The result is the same: the people who should be hiring you don&rsquo;t know you exist.
        </p>
      </Reveal>
      <div className="mt-20 flex justify-end">
        <Scramble text="[ FEATURED WORK ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaIntro.tsx && git commit -m "feat(lama): add intro statement section"`

---

### Task 9: Featured work rows

**Files:**
- Create: `app/components/lama/LamaWork.tsx`

**Interfaces:**
- Consumes: `clients`, `wixImg` from `./workData` (Task 2).

- [ ] **Step 1: Create `app/components/lama/LamaWork.tsx`**

```tsx
import Link from 'next/link'
import Reveal from './Reveal'
import { clients, wixImg } from './workData'

export default function LamaWork() {
  return (
    <section data-lama-title="SELECTED WORK" className="bg-ink border-t border-cream/10">
      {clients.map((c, i) => (
        <Reveal key={c.name} delay={Math.min(i * 60, 240)}>
          <Link
            href="/work"
            className="group grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] items-center gap-6 px-6 sm:px-10 py-8 border-b border-cream/10 hover:bg-cream/5 transition-colors"
          >
            <div className="flex items-center gap-6 flex-wrap">
              <span className="font-lamah text-cream text-2xl sm:text-[28px]">{c.name}</span>
              <span className="flex gap-2">
                {c.services.slice(0, 3).map((s) => (
                  <span key={s} className="border border-cream-faint px-2 py-1 font-lamam text-[10px] uppercase tracking-wider text-cream-dim whitespace-nowrap">
                    {s}
                  </span>
                ))}
              </span>
            </div>
            <span className="hidden lg:block font-lamam text-xs text-cream-dim">( + )</span>
            <img
              src={wixImg(c.img, 420, 280)}
              alt={c.name}
              loading="lazy"
              className="h-[100px] sm:h-[140px] w-auto object-cover bg-ink opacity-50 group-hover:opacity-100 group-hover:scale-[1.02] transition-all duration-300"
            />
          </Link>
        </Reveal>
      ))}
    </section>
  )
}
```

(Each client has a single image id in `workData.ts`, so the row shows one thumbnail; if more image ids are added later the strip can map over them.)

- [ ] **Step 2: Verify** — `npm run build` passes; dev check: 7 rows render, hover brightens image, row links to `/work`.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaWork.tsx && git commit -m "feat(lama): add featured work rows"`

---

### Task 10: Services columns

**Files:**
- Create: `app/components/lama/LamaServices.tsx`

- [ ] **Step 1: Create `app/components/lama/LamaServices.tsx`** (list items sourced from existing services/work copy)

```tsx
import Reveal from './Reveal'
import { Scramble } from './Scramble'

const COLUMNS = [
  { label: '[ CONTENT ]', items: ['Content Production', 'Social Media Management', 'Brand Photography', 'Video Direction'] },
  { label: '[ ADVERTISING ]', items: ['Paid Ads — Meta & Google', 'Performance Strategy', 'Lead Generation'] },
  { label: '[ BRAND & STRATEGY ]', items: ['Brand Strategy', 'Visual Identity', 'Messaging', 'Strategy & Consulting'] },
]

export default function LamaServices() {
  return (
    <section data-lama-title="WHAT WE DO" className="bg-ink bg-lama-dots [background-size:4px_4px] px-6 sm:px-10 py-32 sm:py-44">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(3rem,8vw,7.5rem)]">
          What we do.
        </h2>
      </Reveal>
      <Reveal delay={150}>
        <p className="mt-10 font-lamah text-cream-dim text-lg max-w-xl">
          Start with content. Scale into the rest.
        </p>
      </Reveal>
      <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-12">
        {COLUMNS.map((col, i) => (
          <Reveal key={col.label} delay={i * 120}>
            <Scramble text={col.label} className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
            <ul className="mt-6 space-y-3">
              {col.items.map((item) => (
                <li key={item} className="font-lamah text-cream text-lg">{item}</li>
              ))}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaServices.tsx && git commit -m "feat(lama): add services columns"`

---

### Task 11: Logo marquee

**Files:**
- Create: `app/components/lama/LamaLogos.tsx`

**Interfaces:**
- Consumes: same 13 Wix logo ids as `app/components/home/HomeLogoStrip.tsx:1-15` (copy the array verbatim into this file; do not import from or modify HomeLogoStrip).

- [ ] **Step 1: Create `app/components/lama/LamaLogos.tsx`**

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

export default function LamaLogos() {
  const doubled = [...logos, ...logos]
  return (
    <div aria-label="Clients and partners" className="bg-ink border-y border-cream/10 py-10 overflow-hidden">
      <div className="flex w-max animate-lama-marquee motion-reduce:animate-none gap-16 px-8">
        {doubled.map((logo, i) => (
          <img
            key={i}
            src={`https://static.wixstatic.com/media/${logo}/v1/fit/w_213,h_90,q_90,enc_avif,quality_auto/${logo}`}
            alt=""
            loading="lazy"
            className="h-10 w-auto opacity-40 grayscale"
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `npm run build` passes; dev check: marquee scrolls continuously, pauses under reduced motion.

- [ ] **Step 3: Commit** — `git add app/components/lama/LamaLogos.tsx && git commit -m "feat(lama): add logo marquee"`

---

### Task 12: Culture + contact sections

**Files:**
- Create: `app/components/lama/LamaCulture.tsx`
- Create: `app/components/lama/LamaContact.tsx`

- [ ] **Step 1: Create `app/components/lama/LamaCulture.tsx`** (copy is HomeWhyUs card copy, merged verbatim)

```tsx
import Reveal from './Reveal'
import { Scramble } from './Scramble'

export default function LamaCulture() {
  return (
    <section data-lama-title="WHY MD MEDIA" className="bg-ink grid grid-cols-1 lg:grid-cols-[55%_45%]">
      <div className="px-6 sm:px-10 py-32">
        <Scramble text="[ WHY US ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
        <Reveal delay={100}>
          <p className="mt-10 font-lamah text-cream text-[clamp(1.5rem,2.6vw,2.25rem)] leading-tight [text-indent:3em]">
            We make you visible first, then build the strategy and systems behind it.
            Content, paid, brand, and strategy under one roof — no juggling vendors.
            Your content sounds like you and looks like you, not a template.
            Start small, scale when it&rsquo;s working.
          </p>
        </Reveal>
      </div>
      <div className="relative min-h-[320px] lg:min-h-0">
        <img
          src="https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg/v1/fill/w_1200,h_1200,al_c,q_85,enc_avif,quality_auto/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg"
          alt="MD Media behind the scenes"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Create `app/components/lama/LamaContact.tsx`** (copy is HomeCtaBanner's, verbatim)

```tsx
import Link from 'next/link'
import Reveal from './Reveal'
import { Scramble } from './Scramble'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function LamaContact() {
  return (
    <section data-lama-title="BOOK A CALL" className="bg-ink bg-lama-dots [background-size:4px_4px] px-6 sm:px-10 pt-32 sm:pt-44 pb-40">
      <Reveal>
        <h2 className="font-lamah font-bold uppercase text-cream leading-[0.8] tracking-[-0.02em] text-[clamp(2.75rem,7.5vw,7rem)] max-w-5xl">
          Ready to stop being the best-kept secret?
        </h2>
      </Reveal>
      <div className="mt-16 max-w-lg">
        <Scramble text="[ GET IN TOUCH ]" className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim" />
        <Reveal delay={100}>
          <p className="mt-6 font-lamah text-cream-dim text-lg leading-relaxed">
            Book a free strategy call. We&rsquo;ll look at where you&rsquo;re invisible, where the
            opportunity is, and exactly what we&rsquo;d do first. No obligation, no hard sell.
          </p>
        </Reveal>
      </div>
      <Reveal delay={200}>
        <div className="mt-12 flex flex-wrap gap-4">
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream hover:bg-cream hover:text-ink transition-colors"
          >
            BOOK A STRATEGY CALL ↗
          </a>
          <Link
            href="/work"
            className="border border-cream/25 px-6 py-4 font-lamam text-xs uppercase tracking-widest text-cream hover:bg-cream hover:text-ink transition-colors"
          >
            SEE OUR WORK ↗
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
```

- [ ] **Step 3: Verify** — `npm run build` passes.

- [ ] **Step 4: Commit** — `git add app/components/lama/LamaCulture.tsx app/components/lama/LamaContact.tsx && git commit -m "feat(lama): add culture and contact sections"`

---

### Task 13: Assemble homepage + final verification

**Files:**
- Modify: `app/page.tsx` (full replacement of the component body; **keep the existing `metadata` export exactly as-is**, lines 14–35)

**Interfaces:**
- Consumes: every component from Tasks 4–12, `archivo`/`sometype` from Task 1.

- [ ] **Step 1: Replace `app/page.tsx` component (keep metadata export)**

```tsx
import type { Metadata } from 'next'
import { archivo, sometype } from './components/lama/fonts'
import LamaLoader from './components/lama/LamaLoader'
import LamaNav from './components/lama/LamaNav'
import LamaHero from './components/lama/LamaHero'
import LamaIntro from './components/lama/LamaIntro'
import LamaWork from './components/lama/LamaWork'
import LamaServices from './components/lama/LamaServices'
import LamaLogos from './components/lama/LamaLogos'
import LamaCulture from './components/lama/LamaCulture'
import LamaContact from './components/lama/LamaContact'
import LamaFooterBar from './components/lama/LamaFooterBar'

// metadata export: unchanged, keep verbatim

export default function HomePage() {
  return (
    <div className={`${archivo.variable} ${sometype.variable} bg-ink`}>
      <LamaLoader />
      <LamaNav />
      <main>
        <LamaHero />
        <LamaIntro />
        <LamaWork />
        <LamaServices />
        <LamaLogos />
        <LamaCulture />
        <LamaContact />
      </main>
      <LamaFooterBar />
    </div>
  )
}
```

- [ ] **Step 2: Build** — `npm run build`. Expected: passes.

- [ ] **Step 3: Visual pass** — `npm run dev`, open `/` in the browser and verify against the reference behaviours: preloader counts 0→100 then fades; hero headline huge/uppercase/cream on dotted charcoal; nav pill title changes (with scramble) while scrolling through sections; micro-labels scramble in on scroll; 7 work rows with hover; marquee scrolls; metadata bar shows live clock; mobile 390px: no horizontal overflow, footer bar hidden, overlay menu works. Verify `/work` still renders identically. Fix anything that fails before committing.

- [ ] **Step 4: Commit** — `git add app/page.tsx && git commit -m "feat: launch Lama-Lama-style homepage"`
