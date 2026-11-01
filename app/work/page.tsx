import type { Metadata } from 'next'
import { archivo, sometype } from '../components/lama/fonts'
import MdNav from '../components/md-nav/MdNav'
import MdFooter from '../components/md-footer/MdFooter'
import { CALENDLY } from '../components/service-page/ServicePage'
import { getSiteProjects } from '../lib/websiteData'
import { SECTORS, sectorCount, type SectorClient } from './sectors'
import './work.css'

export const metadata: Metadata = {
  title: 'Our Work — MD Media Marketing',
  description:
    'The businesses we made impossible to ignore. Finance, trades, clinics, hospitality and retail — the content, campaigns and brands we’ve built.',
  robots: 'index, follow',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/work' },
}

// case-study links follow the CMS: refresh at most every 5 minutes
export const revalidate = 300

const pad = (i: number) => String(i + 1).padStart(2, '0')

function Cover({ c }: { c: SectorClient }) {
  if (c.media?.video) {
    return (
      <video className="wk-media" autoPlay muted loop playsInline preload="metadata" poster={`${c.media.video}.jpg`} aria-label={c.name}>
        <source src={`${c.media.video}.mp4`} type="video/mp4" />
      </video>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  if (c.media?.image) return <img className="wk-media" src={c.media.image} alt={c.name} loading="lazy" />
  return <div className="wk-media wk-empty">{c.name}<br />cover image</div>
}

export default async function WorkPage() {
  // A "Case study" link only shows when that study is actually published in the CMS.
  const published = new Set((await getSiteProjects()).map(p => p.slug))
  const total = SECTORS.reduce((n, s) => n + sectorCount(s), 0)

  return (
    <div className={`wk ${archivo.variable} ${sometype.variable}`}>
      <MdNav band />
      <main className="wk-wrap">
        <header className="wk-head">
          <h1>Work.</h1>
          <p className="wk-mono">The businesses we made<br />impossible to ignore.<br />{total} clients.</p>
        </header>

        <div className="wk-sectors">
          {SECTORS.map(s => (
            <details key={s.n} className="wk-sector">
              <summary>
                <span className="wk-n">{s.n}</span>
                <span className="wk-name">{s.name}<sup className="wk-mono">({sectorCount(s)})</sup></span>
                <span className="wk-tags wk-mono">{s.tags.map(t => <span key={t}>{t}</span>)}</span>
                <span className="wk-toggle" aria-hidden="true" />
              </summary>
              <ol className="wk-grid">
                {s.clients.map((c, i) => {
                  const study = c.slug && published.has(c.slug) ? `/work/${c.slug}` : null
                  return (
                    <li key={c.name} className="wk-card">
                      {study ? <a href={study} aria-label={`${c.name} case study`}><Cover c={c} /></a> : <Cover c={c} />}
                      <p className="wk-cap wk-mono"><span>( {pad(i)} )</span><span>{c.name}</span></p>
                      <p className="wk-meta wk-mono">
                        <span>{c.current ? 'Current' : ''}</span>
                        {study && <a href={study}>Case study ↗</a>}
                      </p>
                      {c.desc && <p className="wk-desc">{c.desc}</p>}
                    </li>
                  )
                })}
              </ol>
            </details>
          ))}
        </div>

        <section className="wk-cta">
          <p>Your industry next?</p>
          <a href={CALENDLY} target="_blank" rel="noreferrer noopener" className="wk-btn wk-mono">Book a free strategy call ↗</a>
        </section>
      </main>
      <MdFooter />
    </div>
  )
}
