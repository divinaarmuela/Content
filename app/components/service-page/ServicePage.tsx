import MdNav from '../md-nav/MdNav'
import MdFooter from '../md-footer/MdFooter'
import LogoWall from '../logo-wall/LogoWall'
import { archivo, sometype } from '../lama/fonts'
import './service-page.css'

/**
 * One template for the five service pages (Oct 2026 design). Each page passes its copy;
 * the layout, nav, footer and logo wall are shared so the pages cannot drift apart.
 */

export const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

// Strategy & Consulting and Paid Advertising have no page yet — they point at the closest live page until theirs exist.
export const SERVICE_LINKS = {
  strategy: { n: '01', name: 'Strategy & Consulting', href: '/services/strategy' },
  branding: { n: '02', name: 'Branding Suite', href: '/services/branding-suite' },
  websites: { n: '03', name: 'Custom Websites', href: '/website' },
  content: { n: '04', name: 'Content & Visibility', href: '/services/content-visibility' },
} as const
type ServiceKey = keyof typeof SERVICE_LINKS

/** A loop (`video`, served as `${video}.mp4` with `${video}.jpg` poster), a still (`image`), or neither (a labelled empty slot). */
export type Media = { video?: string; image?: string; label: string }

export type ServicePageProps = {
  current: ServiceKey
  hero: Media
  lead: string
  body: string
  familiar?: { heading: string; pairs: [string, string][] }
  covered: { title: string; desc: string; href?: string }[]
  steps: [string, string][]
  related: { key: ServiceKey; desc: string }[]
  /** `builtSite`: we built the site `href` opens — the card says so under its name. */
  work: { name: string; href: string; media: Media; builtSite?: boolean }[]
  quote?: { text: string; who: string; tags: string[] }
  logosTitle?: string
  faqs: [string, string][]
}

function Slot({ media }: { media: Media }) {
  if (media.video) {
    return (
      <video className="cv-media" autoPlay muted loop playsInline preload="metadata" poster={`${media.video}.jpg`} aria-label={media.label}>
        <source src={`${media.video}.mp4`} type="video/mp4" />
      </video>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  if (media.image) return <img className="cv-media" src={media.image} alt={media.label} loading="lazy" />
  return <div className="cv-placeholder">{media.label}</div>
}

const pad = (i: number) => String(i + 1).padStart(2, '0')

export default function ServicePage(p: ServicePageProps) {
  const me = SERVICE_LINKS[p.current]
  return (
    <div className={`${archivo.variable} ${sometype.variable}`}>
      <MdNav />
      <main className="cv">
        <div className="cv-wrap cv-head">
          <p className="cv-crumb"><a href="/services">Services</a> / ( {me.n} ) {me.name}</p>
          <h1 className="cv-h1">{me.name}</h1>
          <div className="cv-hero"><Slot media={p.hero} /></div>
        </div>

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">Overview</h2>
          <p className="cv-lead">{p.lead}</p>
          <p className="cv-body">{p.body}</p>
        </section>

        {p.familiar && (
          <section className="cv-wrap cv-sec">
            <h2 className="cv-eyebrow">Sound familiar?</h2>
            <p className="cv-h2">{p.familiar.heading}</p>
            <div className="cv-pairs-head cv-eyebrow" aria-hidden="true">
              <span>What you’re seeing</span><span>What’s usually behind it</span>
            </div>
            {p.familiar.pairs.map(([seen, behind]) => (
              <div key={seen} className="cv-pair">
                <p>{seen}</p>
                <p>{behind}</p>
              </div>
            ))}
          </section>
        )}

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">What’s covered</h2>
          <ol className="cv-rows">
            {p.covered.map((c, i) => {
              const inner = (
                <>
                  <span className="cv-idx">{pad(i)}</span>
                  <span className="cv-row-t">{c.title}</span>
                  <span className="cv-row-d">{c.desc}</span>
                </>
              )
              return <li key={c.title}>{c.href ? <a className="cv-row" href={c.href}>{inner}</a> : <div className="cv-row">{inner}</div>}</li>
            })}
          </ol>
        </section>

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">How we work</h2>
          <ol className="cv-steps">
            {p.steps.map(([t, d], i) => (
              <li key={t}>
                <span className="cv-idx">[ {pad(i)} ]</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">Part of the bigger picture</h2>
          <p className="cv-body cv-narrow">One team across strategy, brand, web and content. Here’s how this work connects to the rest.</p>
          <ul className="cv-rows">
            {p.related.map(r => (
              <li key={r.key}>
                <a className="cv-row cv-row-link" href={SERVICE_LINKS[r.key].href}>
                  <span className="cv-row-t">{SERVICE_LINKS[r.key].name}</span>
                  <span className="cv-row-d">{r.desc}</span>
                  <span className="cv-view">( View )</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="cv-wrap cv-sec">
          <div className="cv-split">
            <h2 className="cv-eyebrow">Selected work</h2>
            <a className="cv-view" href="/work">( All work )</a>
          </div>
          <div className="cv-work">
            {p.work.map((w, i) => (
              <a key={w.name} href={w.href} className="cv-card" {...(/^https?:/.test(w.href) ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
                <div className="cv-card-media"><Slot media={w.media} /></div>
                <span className="cv-card-cap">
                  <span>( {pad(i)} ) {w.name} ↗</span>
                  {w.builtSite && <span className="cv-card-site">Website we built · {new URL(w.href).hostname.replace(/^www\./, '')}</span>}
                </span>
              </a>
            ))}
          </div>
        </section>

        {p.quote && (
          <section className="cv-wrap cv-sec">
            <h2 className="cv-eyebrow">Client word</h2>
            <blockquote className="cv-quote">“{p.quote.text}”</blockquote>
            <p className="cv-cite">
              <span>{p.quote.who}</span>
              {p.quote.tags.map((t, i) => <span key={t}>({pad(i)}) {t}</span>)}
            </p>
          </section>
        )}

        <LogoWall className="cv-wrap cv-sec" title={p.logosTitle} />

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">Common questions</h2>
          <dl className="cv-rows">
            {p.faqs.map(([q, a]) => (
              <div key={q} className="cv-row cv-faq">
                <dt className="cv-row-t">{q}</dt>
                <dd className="cv-row-d">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="cv-wrap cv-sec">
          <h2 className="cv-eyebrow">All services</h2>
          <ul className="cv-all">
            {Object.entries(SERVICE_LINKS).map(([key, s]) => (
              <li key={key}>
                {key === p.current
                  ? <span aria-current="page" className="cv-current"><span>{s.name}</span><span className="cv-idx">{s.n}</span></span>
                  : <a href={s.href}><span>{s.name}</span><span className="cv-idx">{s.n}</span></a>}
              </li>
            ))}
          </ul>
        </section>

        <section className="cv-wrap cv-cta">
          <p>Have a project in mind?</p>
          <a href={CALENDLY} target="_blank" rel="noreferrer noopener">( Book a call )</a>
          <a href="mailto:hello@mdmmarketing.com.au">( hello@mdmmarketing.com.au )</a>
        </section>
      </main>

      <MdFooter
        bar={
          <>
            <span><a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">@mdmedia._</a> | <a href="/">mdmmarketing.com.au</a></span>
            <span>© MD Media</span>
          </>
        }
      />
    </div>
  )
}
