'use client'

import { useEffect, useState } from 'react'
import Reveal from '../components/lama/Reveal'
import LamaLogos from '../components/lama/LamaLogos'

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
      <style>{`:where(.disc) :where(h1,h2,h3,p,ol,dl,dd){margin:0}:where(.disc) :where(ol){list-style:none;padding:0}:where(.disc) :where(button){appearance:none;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;border-radius:0}:where(.disc) :where(button:disabled){cursor:default}`}</style>
      {/* the site's dotted field, and one soft blue light behind the headline */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-lama-dots [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_78%)]" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] max-w-[140vw] -translate-x-1/2 rounded-full bg-accent/20 blur-[120px]" />

      <header className="relative z-10 border-b border-cream/15">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6 sm:px-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <a href="https://www.mdmmarketing.com.au" aria-label="MD Media"><img src="/MDLogo-trim.png" alt="MD Media" className="h-5 w-auto" /></a>
          <p className="font-lamam text-[10px] uppercase tracking-widest text-cream-dim">Discovery form</p>
          <p className="ml-auto hidden font-lamam text-[10px] uppercase tracking-widest text-cream-dim sm:block">About 10 minutes · No login</p>
        </div>
      </header>

      <main className="relative z-10">
        {/* ── the hero: what this is, and the one thing to do ── */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 sm:px-10 sm:pb-28 sm:pt-28">
          <p className="mb-7 font-lamam text-[11px] uppercase tracking-widest text-accent [word-spacing:0.35em]">[ Before we talk ]</p>
          <h1 className="max-w-4xl font-lamah text-[clamp(2.6rem,8vw,6.25rem)] font-medium leading-[0.98] tracking-[-0.04em]">
            <Reveal gate={false} className="block">Tell us about</Reveal>
            <Reveal gate={false} delay={110} className="block">your business.</Reveal>
          </h1>
          <Reveal gate={false} delay={240}>
            <p className="mt-8 max-w-xl font-lamah text-[18px] leading-relaxed text-cream-dim sm:text-[20px]">
              A few short questions, so that when we speak we already know where you are, where you want to be, and what is in the way.
            </p>
          </Reveal>
          <div className="mt-11 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <Begin wide />
            {resume && !busy ? (
              <button type="button" onClick={startOver} className="inline-flex min-h-11 items-center font-lamam text-[11px] uppercase tracking-widest text-cream-dim underline underline-offset-4 hover:text-cream">
                Start a new one
              </button>
            ) : (
              <p className="font-lamam text-[11px] uppercase tracking-widest text-cream-dim">Saves as you go · Skip what you like</p>
            )}
          </div>
          {error && <p role="alert" className="mt-5 text-[15px] text-[#E2725B]">{error}</p>}

          <dl className="mt-16 grid max-w-3xl grid-cols-3 border-t border-cream/15">
            {[['10', 'minutes'], ['7', 'short parts'], ['0', 'logins']].map(([n, w]) => (
              <div key={w} className="border-r border-cream/15 py-6 pr-4 last:border-r-0 sm:px-6 sm:first:pl-0">
                <dt className="font-lamah text-[clamp(2rem,6vw,3.5rem)] font-medium leading-none tracking-[-0.04em]">{n}</dt>
                <dd className="mt-2 font-lamam text-[10px] uppercase tracking-widest text-cream-dim">{w}</dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="border-y border-cream/15"><LamaLogos /></div>

        {/* ── what they will be asked ── */}
        <section className="mx-auto max-w-6xl px-6 py-20 sm:px-10 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div>
              <p className="mb-5 font-lamam text-[11px] uppercase tracking-widest text-cream-dim">[ 01 ] What we ask</p>
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
            <p className="mb-5 font-lamam text-[11px] uppercase tracking-widest text-cream-dim">[ 02 ] What happens next</p>
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
