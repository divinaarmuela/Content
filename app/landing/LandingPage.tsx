import type { ReactNode } from 'react'
import { archivo, sometype } from '../components/lama/fonts'
import LazyLoop from '../components/lazy-loop/LazyLoop'
import MdNav from '../components/md-nav/MdNav'
import { logoFile } from '../components/logo-wall/LogoWall'
import SmileStrip from '../services/hospitality/SmileStrip'
import '../components/service-page/service-page.css'
import '../services/hospitality/hospitality.css'
import './landing.css'
import { bookCallHref } from '../lib/book-call-core'

/**
 * AD LANDING PAGES, /landing/<service> (11 Nov 2026, the owner: "create all new landing pages with /landing … the
 * name of services, without in menu, we will be using these for ads like hospitality … use existing assets from
 * their pages and create nice ones similar to the hospitality one, light theme", "with more CTAs", "CTAs should not be
 * named book a call"). One shared design: the hospitality page's light theme and MD-blue accent (its .cv.hx styles),
 * every button to the one booking page (/book-call, tagged cta=landing-<slug>; the page they came from is added at
 * click time, so Leads shows "Booked from: /landing/<slug>"). Not in the menu, kept out of search.
 */

export type LMedia = { video?: string; image?: string; label: string; shape?: 'portrait' | 'landscape' | 'square' }
export type LandingData = {
  slug: string
  headline: ReactNode
  lead: string
  hero: LMedia
  /** button words, used in turn down the page (never "Book a call") */
  ctas: string[]
  note?: string
  logos: string[]
  logosText?: string[]
  problems?: { heading: string; pairs: [string, string][] }
  workHeading: string
  work: { name: string; kind?: string; line?: string; href?: string; media: LMedia }[]
  included: { heading: string; items: { title: string; desc: string }[] }
  strip?: { src: string; alt: string }[]
  steps: [string, string][]
  quote?: { text: string; who: string }
  faqs: [string, string][]
}

function Media({ m, className = '' }: { m: LMedia; className?: string }) {
  return (
    <div className={`lp-media lp-${m.shape ?? 'portrait'} ${className}`}>
      {m.video
        ? <LazyLoop className="hx-fill" src={m.video} label={m.label} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img className="hx-fill" src={m.image} alt={m.label} loading="lazy" decoding="async" />}
    </div>
  )
}

export default function LandingPage({ d }: { d: LandingData }) {
  const href = bookCallHref(`landing-${d.slug}`)
  let i = 0
  const Cta = ({ light = false, center = false }: { light?: boolean; center?: boolean }) => {
    const words = d.ctas[i++ % d.ctas.length]
    return (
      <div className={`lp-cta${center ? ' lp-cta-center' : ''}`}>
        <a href={href} className={`hx-btn${light ? ' hx-btn-light' : ''}`}>{words}</a>
        {d.note && <p className="hx-note">{d.note}</p>}
      </div>
    )
  }
  const heroWide = d.hero.shape === 'landscape'

  return (
    <div className={`lp-dark ${archivo.variable} ${sometype.variable}`}>
      <MdNav band />
      <main className="cv hx lp">
        {/* HERO: on phones the film fills the screen behind the words (hospitality.css) */}
        <section className={`cv-wrap hx-hero${heroWide ? ' lp-hero-wide' : ''}`}>
          <div>
            <h1 className="cv-h1">{d.headline}</h1>
            <p className="cv-lead">{d.lead}</p>
            <Cta />
          </div>
          <div className="hx-hero-film">
            {d.hero.video
              ? <video src={`${d.hero.video}.mp4`} poster={`${d.hero.video}.jpg`} autoPlay muted loop playsInline preload="auto" aria-label={d.hero.label} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={d.hero.image} alt={d.hero.label} />}
          </div>
        </section>

        {/* LOGOS: a straight endless marquee */}
        <div className="hx-trusted">
          <div className="hx-logos" aria-label="Brands we’ve worked with">
            <ul className="hx-logos-track">
              {[0, 1].map(copy => [
                ...d.logos.map(b => (
                  <li key={`${b}-${copy}`} aria-hidden={copy === 1}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/logos/content-visibility/${logoFile(b)}.png`} alt={copy === 0 ? b : ''} loading="lazy" />
                  </li>
                )),
                ...(d.logosText ?? []).map(b => <li key={`${b}-t-${copy}`} className="hx-logo-text" aria-hidden={copy === 1}>{b}</li>),
              ])}
            </ul>
          </div>
        </div>

        {/* SOUND FAMILIAR: the problem in their words, our read underneath */}
        {d.problems && (
          <section className="cv-wrap hx-sec">
            <h2 className="hx-h2 lp-wide-h2">{d.problems.heading}</h2>
            <div className="lp-problems">
              {d.problems.pairs.map(([p, a]) => (
                <article key={p} className="lp-problem">
                  <p className="lp-problem-q">{p}</p>
                  <p className="lp-problem-a">{a}</p>
                </article>
              ))}
            </div>
            <Cta />
          </section>
        )}

        {/* THE WORK: a zigzag, one row per piece */}
        <section className="cv-wrap hx-sec">
          <h2 className="hx-h2">{d.workHeading}</h2>
          <div className="hx-zig lp-zig">
            {d.work.map(w => (
              <article key={w.name} className="hx-zig-row lp-zig-row">
                <Media m={w.media} className="lp-zig-media" />
                <div className="hx-story">
                  <h3 className="hx-story-venue">{w.name}</h3>
                  {w.kind && <p className="lp-kind">{w.kind}</p>}
                  {w.line && <p className="hx-story-line">{w.line}</p>}
                  {w.href && <a className="lp-link" href={w.href} target={w.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer noopener">See it live ↗</a>}
                </div>
              </article>
            ))}
          </div>
          <Cta />
        </section>

        {/* WHAT'S INCLUDED */}
        <section className="cv-wrap hx-sec">
          <h2 className="hx-h2">{d.included.heading}</h2>
          <div className="lp-included">
            {d.included.items.map((c, n) => (
              <article key={c.title} className="lp-inc">
                <p className="lp-inc-n">{String(n + 1).padStart(2, '0')}</p>
                <p className="lp-inc-t">{c.title}</p>
                <p className="lp-inc-d">{c.desc}</p>
              </article>
            ))}
          </div>
          <Cta />
        </section>

        {/* STILLS on the cosine smile marquee */}
        {d.strip && d.strip.length > 0 && <SmileStrip photos={d.strip} base="" />}

        {/* HOW IT WORKS */}
        <section className="cv-wrap hx-sec">
          <h2 className="hx-h2">How it works.</h2>
          <ol className="hx-steps lp-steps">
            {d.steps.map(([t, s], n) => (
              <li key={t}><span className="hx-step-n">0{n + 1}</span><p className="hx-step-t">{t}</p>{s && <p className="hx-step-d">{s}</p>}</li>
            ))}
          </ol>
          <Cta />
        </section>

        {/* QUOTE: the one dark moment */}
        {d.quote && (
          <div className="hx-quote-wrap">
            <section className="cv-wrap lp-quote">
              <blockquote>
                <p>“{d.quote.text}”</p>
                <p className="hx-cite">{d.quote.who}</p>
              </blockquote>
              <Cta light />
            </section>
          </div>
        )}

        {/* QUESTIONS */}
        <section className="cv-wrap hx-sec hx-faq-grid">
          <h2 className="hx-h2">Good questions.</h2>
          <div className="hx-faq">
            {d.faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </div>
        </section>

        {/* LAST PUSH */}
        <section className="cv-wrap hx-sec hx-book">
          <h2 className="cv-h1 hx-book-h">Let’s talk about what’s next.</h2>
          <p className="cv-lead">Ten minutes. Tell us where you are; we’ll tell you honestly what we’d do and what it would cost.</p>
          <Cta center />
        </section>

        <div className="cv-wrap hx-foot">© MD Media Marketing Pty Ltd · ABN 75 681 730 512 · <a href="/privacy">Privacy</a></div>
      </main>
    </div>
  )
}
