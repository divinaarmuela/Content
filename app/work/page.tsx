import ScrollObserver from '../components/ScrollObserver'
import SiteMedia from '../components/SiteMedia'
import { getSiteProjects, type SiteProject } from '../lib/websiteData'

// grid refreshes from the CMS at most every 5 minutes
export const revalidate = 300

function WorkCard({ p, feature, delay }: { p: SiteProject; feature?: boolean; delay?: number }) {
  return (
    <a
      href={`/work/${p.slug}`}
      className={`work-card${feature ? ' work-card-feature' : ''} fade-up${delay ? ` d${delay}` : ''}`}
    >
      <div className="work-card-img">
        <SiteMedia src={p.cardMedia} alt={p.name} className="" />
        {p.result && <span className="work-result">{p.result}</span>}
      </div>
      <div className="work-card-info">
        <div className="work-card-head">
          <span className="work-tag">{p.tag}</span>
          <span className="work-industry">{p.industry}</span>
        </div>
        <h2 className="work-name">{p.name}</h2>
        <p className="work-desc">{p.desc}</p>
        <div className="work-services">
          {p.services.map(s => <span key={s}>{s}</span>)}
        </div>
      </div>
    </a>
  )
}

/** Layout pattern that scales to any project count:
 *  2-up · full-width feature · repeating [3-up · feature] until done. */
function rows(projects: SiteProject[]) {
  const out: { kind: 'pair' | 'feature' | 'triple'; items: SiteProject[] }[] = []
  let i = 0
  if (projects.length >= 2) { out.push({ kind: 'pair', items: projects.slice(0, 2) }); i = 2 }
  if (i < projects.length) { out.push({ kind: 'feature', items: [projects[i]] }); i += 1 }
  while (i < projects.length) {
    const chunk = projects.slice(i, i + 3)
    if (chunk.length === 1) out.push({ kind: 'feature', items: chunk })
    else out.push({ kind: 'triple', items: chunk })
    i += chunk.length
    if (i < projects.length) { out.push({ kind: 'feature', items: [projects[i]] }); i += 1 }
  }
  return out
}

export default async function WorkPage() {
  const projects = await getSiteProjects()

  return (
    <>
      <main>

        {/* HERO */}
        <section className="hero">
          <div className="hero-bg">
            <img
              src="https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg"
              alt=""
              aria-hidden="true"
            />
            <div className="hero-overlay" />
          </div>
          <div className="container hero-inner">
            <p className="hero-tagline">Selected Work — 2024 &ndash; 2026</p>
            <h1 className="hero-h1">Our work.</h1>
            <p className="hero-desc">
              Brands built, content produced, results delivered.{' '}
              Across hospitality, finance, fashion, and everything in between.
            </p>
          </div>
        </section>

        {/* STATS STRIP */}
        <div className="stats-strip">
          <div className="container stats-inner">
            <div className="stat-item"><span className="stat-val">17</span><span className="stat-label">Active retainers</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">6</span><span className="stat-label">Industries</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">500+</span><span className="stat-label">Assets / month</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val blue">2024</span><span className="stat-label">Est. Melbourne</span></div>
          </div>
        </div>

        {/* WORK GRID */}
        <section className="work-section">
          <div className="container">
            {rows(projects).map((row, ri) => (
              <div
                key={ri}
                className={`work-row ${row.kind === 'pair' ? 'work-row-2' : row.kind === 'triple' ? 'work-row-3' : 'work-row-feature'}`}
              >
                {row.items.map((p, i) => (
                  <WorkCard key={p.slug} p={p} feature={row.kind === 'feature'} delay={i} />
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Want results like these?</p>
                <h2 className="cta-heading">
                  Let&apos;s build something<br />
                  worth <span className="blue">talking about.</span>
                </h2>
                <p className="cta-sub">
                  Limited intake each month. Tell us about your business and we&apos;ll map out what&apos;s possible.
                </p>
                <div className="cta-btns">
                  <a href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone" className="btn" target="_blank" rel="noreferrer noopener">
                    Book a call <span className="arr">→</span>
                  </a>
                  <a href="http://scorecard.mdmmarketing.com.au" className="btn btn-outline" target="_blank" rel="noreferrer noopener">
                    Free diagnostic <span className="arr">→</span>
                  </a>
                </div>
              </div>
              <div className="cta-right" style={{ display: 'flex', flexDirection: 'column', gap: '24px', justifyContent: 'center' }}>
                {[
                  { metric: '2 → 12', label: 'Leads per month', client: 'Cutter & Co' },
                  { metric: '0 → 30', label: 'Bookings per day', client: 'Senorita Debutante' },
                  { metric: '19×', label: 'ROAS', client: 'Automodellista' },
                  { metric: '$15K→$5K', label: 'Ad spend', client: 'MGMT Aus' },
                ].map(r => (
                  <div key={r.client} className="work-result-row fade-up">
                    <div>
                      <span className="work-result-metric">{r.metric}</span>
                      <span className="work-result-label">{r.label}</span>
                    </div>
                    <span className="work-result-client">{r.client}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer>
        <div className="container">
          <div className="footer-top">
            <div>
              <a href="/" className="footer-mast" aria-label="MD Media Marketing home">
                <img src="https://static.wixstatic.com/media/c5a69a_eb5dd45dbca445798fa310acb86c4420~mv2.png" alt="MD Media Marketing" />
              </a>
              <div className="footer-tagline">
                Strategy. Content. Clarity.<br />Built different. Built on intent.
              </div>
            </div>
            <div className="footer-col">
              <h4>&raquo; Services</h4>
              <a href="/content">Content Production</a>
              <a href="/marketing">Ongoing Marketing</a>
              <a href="/branding">Brand Strategy</a>
              <a href="/personal-brand">Personal Brand</a>
              <a href="https://scorecard.mdmmarketing.com.au/" target="_blank" rel="noreferrer noopener">Free Diagnostic</a>
            </div>
            <div className="footer-col">
              <h4>&raquo; Studio</h4>
              <a href="/about">About</a>
              <a href="/journal">Journal</a>
              <a href="/events">The Room</a>
            </div>
            <div className="footer-col">
              <h4>&raquo; Contact</h4>
              <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
              <a href="tel:+61447764477">0447 764 477</a>
              <p>56/21-25 Chambers Rd, Altona North VIC 3025</p>
            </div>
          </div>
          <div className="footer-bottom">
            <span>&copy; 2026 MD Media Marketing Pty Ltd &middot; ABN 75 681 730 512</span>
            <span>Melbourne, Australia</span>
          </div>
        </div>
      </footer>

      <ScrollObserver />
    </>
  )
}
