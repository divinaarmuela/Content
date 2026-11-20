'use client'

import { useEffect, useState } from 'react'
import Reveal from '../components/lama/Reveal'
import BrandBackdrop from '../components/BrandBackdrop'

/**
 * THE DISCOVERY FORM'S FRONT DOOR (the owner, 20 Nov 2026: "can you please create this landing page a very nice
 * page"). It is the first thing a cold contact sees of MD Media, so it is built in the main site's own look — ink,
 * cream, the one blue — and says three things before it asks for anything: what this is, what they will be asked,
 * and what happens after. One action, said three times down the page: Begin.
 *
 * Nothing is made by opening the page (a link preview or a mail scanner opens links too). Begin gives this visitor
 * their own form; the browser remembers it, so coming back to the link carries on where they stopped.
 */
const KEY = 'mdm-discovery-form'

/** the clients' logos, the same thirteen as the homepage's strip */
const LOGOS = Array.from({ length: 13 }, (_, i) => `/logos/logo-${String(i + 1).padStart(2, '0')}.png`)

/** the form's own seven parts, in its order (intake-templates.ts) */
const PARTS: [string, string][] = [
  ['Your details', 'Your name and the best way to reach you.'],
  ['About your business', 'What you do, who you serve, and who you are up against.'],
  ['Goals and challenges', 'Where you want to be in 6 to 12 months, and what is in the way.'],
  ['Current marketing', 'What you use today, what has worked, and what has not.'],
  ['Scope and services', 'What you would like our help with, and anything coming up.'],
  ['Budget and timeline', 'A rough range and when you would like to start.'],
  ['One last thing', 'How you found us.'],
]

const NEXT: [string, string][] = [
  ['You send it in', 'About ten minutes. Short answers are fine, and you can skip anything you are not sure about.'],
  ['We read every answer', 'Before we speak, so the first conversation is about your business and not a list of questions.'],
  ['We get in touch', 'To find a time to talk through what we would do and how.'],
]

export default function DiscoveryStart() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resume, setResume] = useState<string | null>(null)
  useEffect(() => { try { const t = localStorage.getItem(KEY); if (t && /^[0-9a-f-]{36}$/i.test(t)) setResume(t) } catch { /* private window */ } }, [])

  // BACK FROM THE FORM, THE BUTTON IS A BUTTON AGAIN (the owner, 20 Nov 2026: "go back to discovery page, the state is
  // still opening the form"). The browser brings this page back exactly as it was left — mid-press — so every time the
  // page is shown the press is cleared and the remembered form is read again.
  useEffect(() => {
    const shown = () => {
      setBusy(false); setError(null)
      try { const t = localStorage.getItem(KEY); setResume(t && /^[0-9a-f-]{36}$/i.test(t) ? t : null) } catch { /* private window */ }
    }
    window.addEventListener('pageshow', shown)
    return () => window.removeEventListener('pageshow', shown)
  }, [])

  const begin = async () => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      let token = resume
      if (!token) {
        const res = await fetch('/api/discovery/start', { method: 'POST' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok || typeof json.token !== 'string') throw new Error(json?.error ?? 'The form could not be opened. Please try again.')
        token = json.token as string
        try { localStorage.setItem(KEY, token) } catch { /* private window: the form still opens */ }
      }
      window.location.assign(`/intake/${token}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The form could not be opened. Please try again.')
      setBusy(false)
    }
  }
  const startOver = () => { try { localStorage.removeItem(KEY) } catch { /* nothing kept */ } setResume(null) }

  /** the one action: cream on ink, and it inverts under the pointer */
  const Begin = ({ wide = false }: { wide?: boolean }) => (
    <button type="button" onClick={() => void begin()} disabled={busy} data-discovery-begin
      className={`group inline-flex min-h-[56px] items-center justify-center gap-4 border border-cream bg-cream px-8 font-lamam text-[12px] uppercase tracking-[0.2em] text-ink transition-colors duration-300 hover:bg-transparent hover:text-cream focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent disabled:opacity-60 ${wide ? 'w-full sm:w-auto' : ''}`}>
      {busy ? 'Opening the form…' : resume ? 'Carry on with your form' : 'Begin'}
      <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
    </button>
  )

  return (
    <div className="disc relative min-h-screen overflow-x-clip bg-ink text-cream antialiased">
      {/* THE BROWSER'S OWN STYLES ARE SWITCHED OFF HERE (20 Nov 2026: "what's wrong with this coloured form page" — the
          second button was a grey box with unreadable words). The site's reset covers only the dashboard, so a plain
          button here wore the browser's grey face, and lists and headings its margins. Zero-weight rules, so every
          class on the page still wins. */}
      <style>{`.disc section{border-bottom:0}:where(.disc) :where(*,::before,::after){border-width:0;border-style:solid}:where(.disc) :where(h1,h2,h3,p,ol,dl,dd){margin:0}:where(.disc) :where(ol){list-style:none;padding:0}:where(.disc) :where(button){appearance:none;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;border-radius:0}:where(.disc) :where(button:disabled){cursor:default}@keyframes disc-logos{from{transform:translate3d(0,0,0)}to{transform:translate3d(-100%,0,0)}}.disc-logos{animation:disc-logos 40s linear infinite;will-change:transform}@media (prefers-reduced-motion:reduce){.disc-logos{animation:none}}`}</style>
      {/* the dotted field and the drifting blue light: the same backdrop the discovery form draws */}
      <BrandBackdrop />

      {/* THE LOGO, IN THE MIDDLE, AND NOTHING ELSE (the owner, 20 Nov 2026: "just put logo in the middle") */}
      <header className="relative z-10">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-center px-6 sm:px-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href="https://www.mdmmarketing.com.au" aria-label="MD Media"><img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" /></a>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── the hero: what this is, and the one thing to do ── */}
        <section className="mx-auto max-w-6xl px-6 pb-8 pt-9 sm:px-10 sm:pb-20 sm:pt-28">
          <h1 className="max-w-4xl font-lamah text-[clamp(2.6rem,8vw,6.25rem)] font-medium leading-[0.98] tracking-[-0.04em]">
            <Reveal gate={false} className="block">Tell us about</Reveal>
            <Reveal gate={false} delay={110} className="block">your business.</Reveal>
          </h1>
          <Reveal gate={false} delay={240}>
            <p className="mt-5 max-w-xl font-lamah text-[16px] leading-relaxed text-cream-dim sm:mt-8 sm:text-[20px]">
              A few short questions, so that when we speak we already know where you are, where you want to be, and what is in the way.
            </p>
          </Reveal>
          <div className="mt-7 flex flex-col items-start gap-3 sm:mt-11 sm:flex-row sm:items-center sm:gap-5">
            <Begin wide />
            {resume && !busy ? (
              <button type="button" onClick={startOver} className="inline-flex min-h-11 items-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim underline underline-offset-4 hover:text-cream">
                Start a new one
              </button>
            ) : (
              <p className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim">Saves as you go</p>
            )}
          </div>
          {error && <p role="alert" className="mt-5 text-[15px] text-[#E2725B]">{error}</p>}

        </section>

        {/* THE CLIENTS' LOGOS, MOVING, where the three numbers were (the owner, 20 Nov 2026: "remove the minutes and
            stats, have the client marquee logos instead") */}
        <div className="py-9 sm:py-10">
          <p className="mb-7 text-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim">Trusted by founders &amp; local businesses</p>
          {/* A BELT WITH NO END (the owner, 20 Nov 2026: "marquee logos suddenly disappear on the right", then "the marquee
              logo is disappearing after some time"). Two faults, both gone: the homepage's strip loads each logo only as
              it nears the screen, so they popped in at the right edge — here every logo is loaded up front. And one
              long moving strip is a single layer wider than a phone will draw (about 4,096px), so it blanked out —
              here three short strips, each its own layer and exactly alike, each slide by their own width together. */}
          <div aria-label="Clients and partners" className="flex overflow-hidden">
            {[0, 1, 2].map(n => (
              <div key={n} aria-hidden={n > 0} className="disc-logos flex shrink-0 items-center gap-14 pr-14 sm:gap-16 sm:pr-16">
                {LOGOS.map(src => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt="" loading="eager" decoding="sync" className="h-9 w-auto opacity-70 [filter:brightness(0)_invert(1)] sm:h-10" />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ── what they will be asked ── */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:px-10 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div>
              <h2 className="font-lamah text-[clamp(2rem,5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">Seven short parts.<br />No wrong answers.</h2>
              <p className="mt-6 max-w-md text-[16px] leading-relaxed text-cream-dim">Honest and incomplete beats polished. If you do not know something yet, say so and we will pick it up when we talk.</p>
            </div>
            <ol className="border-t border-cream/15">
              {PARTS.map(([title, line], i) => (
                <li key={title} className="group grid grid-cols-[3.25rem_1fr] items-baseline gap-x-4 border-b border-cream/15 py-6 transition-colors duration-300 hover:bg-cream/[0.03] sm:grid-cols-[4.5rem_1fr]">
                  <span className="font-lamam text-[12px] tracking-widest text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3 className="font-lamah text-[22px] font-medium leading-tight tracking-[-0.02em] sm:text-[26px]">{title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-cream-dim">{line}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── what happens after ── */}
        <section className="border-t border-cream/15">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:px-10 sm:py-28">
            <h2 className="max-w-3xl font-lamah text-[clamp(2rem,5vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.035em]">So our first conversation is about you, not a questionnaire.</h2>
            <ol className="mt-12 grid gap-px overflow-hidden border border-cream/15 bg-cream/15 md:grid-cols-3">
              {NEXT.map(([title, line], i) => (
                <li key={title} className="flex flex-col gap-4 bg-ink p-7 sm:p-9">
                  <span className="font-lamam text-[12px] tracking-widest text-accent">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="font-lamah text-[24px] font-medium leading-tight tracking-[-0.02em]">{title}</h3>
                  <p className="text-[15px] leading-relaxed text-cream-dim">{line}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── the same one action, once more ── */}
        <section className="border-t border-cream/15">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-9 px-6 py-20 sm:px-10 sm:py-28 lg:flex-row lg:items-end lg:justify-between">
            <h2 className="max-w-2xl font-lamah text-[clamp(2.2rem,6vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.04em]">Ten minutes now saves an hour later.</h2>
            <Begin wide />
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-cream/15">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-7 font-lamam text-[10px] uppercase tracking-widest text-cream-dim sm:px-10">
          <a href="https://www.mdmmarketing.com.au" style={{ color: 'inherit', textDecoration: 'none' }} className="hover:!text-cream">mdmmarketing.com.au</a>
          <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener" style={{ color: 'inherit', textDecoration: 'none' }} className="hover:!text-cream">@mdmedia._</a>
          <span className="ml-auto">© MD Media · Melbourne</span>
        </div>
      </footer>
    </div>
  )
}
