import ScrollObserver from '../components/ScrollObserver'

const clients = [
  {
    name: 'Pattons',
    industry: 'Hospitality',
    services: ['Content Production', 'Social Media Management', 'Brand Photography'],
    desc: 'Monthly content production and social management for a Melbourne hospitality institution. Consistent visual identity across all platforms.',
    img: 'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg',
    tag: 'HOSp_01',
  },
  {
    name: "Cecconi's Toorak & Flinders",
    industry: 'Fine Dining',
    services: ['Brand Photography', 'Content Production', 'Paid Ads'],
    desc: "Editorial photography and content for two of Melbourne's most recognised fine dining venues. Visual storytelling that earns reservations.",
    img: 'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg',
    tag: 'REST_02',
  },
  {
    name: 'Waterside',
    industry: 'Venue & Events',
    services: ['Ongoing Marketing', 'Content Production', 'Meta Ads'],
    desc: 'Full marketing retainer for a Melbourne waterfront venue. Strategy, production, and performance advertising working as one system.',
    img: 'c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg',
    tag: 'VENUE_03',
  },
  {
    name: 'Chantal Cutter',
    industry: 'Finance / Personal Brand',
    services: ['Personal Brand', 'Content Production', 'LinkedIn Strategy'],
    desc: 'Personal brand build for a Melbourne finance operator. Voice positioning, monthly shoots, and a content system that generates qualified inbound leads.',
    img: 'c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg',
    tag: 'FIN_04',
    result: '2 → 12 leads / month',
  },
  {
    name: 'Park Noire',
    industry: 'Hospitality & Nightlife',
    services: ['Brand Strategy', 'Visual Identity', 'Content Production'],
    desc: 'End-to-end brand strategy and content for a boutique Melbourne venue. Identity built around atmosphere, not just aesthetics.',
    img: 'c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg',
    tag: 'VENUE_05',
  },
  {
    name: 'Intersign',
    industry: 'Signage & Trade',
    services: ['Brand Strategy', 'Content Production', 'Digital Presence'],
    desc: 'Brand positioning and content for a trade business ready to move upmarket. B2B content that speaks to builders, architects, and developers.',
    img: 'c5a69a_142a963c514f4e789ed0b63123dfd7af~mv2.jpg',
    tag: 'TRADE_06',
  },
  {
    name: 'Senorita Debutante',
    industry: 'Fashion & Events',
    services: ['Brand Identity', 'Content Production', 'Social Media'],
    desc: 'Zero to fully booked. Brand identity, shoot production, and a content strategy that turned a fashion debut into a sold-out events calendar.',
    img: 'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg',
    tag: 'FASH_07',
    result: '0 → 30 bookings / day',
  },
]

export default function WorkPage() {
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

            {/* Top row — 2 cards */}
            <div className="work-row work-row-2">
              {clients.slice(0, 2).map((c, i) => (
                <article key={c.name} className={`work-card fade-up${i > 0 ? ' d1' : ''}`}>
                  <div className="work-card-img">
                    <img
                      src={`https://static.wixstatic.com/media/${c.img}/v1/fill/w_900,h_700,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${c.img}`}
                      alt={c.name}
                      loading="lazy"
                    />
                    {c.result && <span className="work-result">{c.result}</span>}
                  </div>
                  <div className="work-card-info">
                    <div className="work-card-head">
                      <span className="work-tag">{c.tag}</span>
                      <span className="work-industry">{c.industry}</span>
                    </div>
                    <h2 className="work-name">{c.name}</h2>
                    <p className="work-desc">{c.desc}</p>
                    <div className="work-services">
                      {c.services.map(s => <span key={s}>{s}</span>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* Full-width feature card */}
            <div className="work-row work-row-feature">
              <article className="work-card work-card-feature fade-up">
                <div className="work-card-img">
                  <img
                    src={`https://static.wixstatic.com/media/${clients[2].img}/v1/fill/w_1400,h_700,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${clients[2].img}`}
                    alt={clients[2].name}
                    loading="lazy"
                  />
                  {clients[2].result && <span className="work-result">{clients[2].result}</span>}
                </div>
                <div className="work-card-info">
                  <div className="work-card-head">
                    <span className="work-tag">{clients[2].tag}</span>
                    <span className="work-industry">{clients[2].industry}</span>
                  </div>
                  <h2 className="work-name">{clients[2].name}</h2>
                  <p className="work-desc">{clients[2].desc}</p>
                  <div className="work-services">
                    {clients[2].services.map(s => <span key={s}>{s}</span>)}
                  </div>
                </div>
              </article>
            </div>

            {/* 3-column row */}
            <div className="work-row work-row-3">
              {clients.slice(3, 6).map((c, i) => (
                <article key={c.name} className={`work-card fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <div className="work-card-img">
                    <img
                      src={`https://static.wixstatic.com/media/${c.img}/v1/fill/w_700,h_600,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${c.img}`}
                      alt={c.name}
                      loading="lazy"
                    />
                    {c.result && <span className="work-result">{c.result}</span>}
                  </div>
                  <div className="work-card-info">
                    <div className="work-card-head">
                      <span className="work-tag">{c.tag}</span>
                      <span className="work-industry">{c.industry}</span>
                    </div>
                    <h2 className="work-name">{c.name}</h2>
                    <p className="work-desc">{c.desc}</p>
                    <div className="work-services">
                      {c.services.map(s => <span key={s}>{s}</span>)}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* Last full-width */}
            <div className="work-row work-row-feature">
              <article className="work-card work-card-feature fade-up">
                <div className="work-card-img">
                  <img
                    src={`https://static.wixstatic.com/media/${clients[6].img}/v1/fill/w_1400,h_700,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/${clients[6].img}`}
                    alt={clients[6].name}
                    loading="lazy"
                  />
                  {clients[6].result && <span className="work-result">{clients[6].result}</span>}
                </div>
                <div className="work-card-info">
                  <div className="work-card-head">
                    <span className="work-tag">{clients[6].tag}</span>
                    <span className="work-industry">{clients[6].industry}</span>
                  </div>
                  <h2 className="work-name">{clients[6].name}</h2>
                  <p className="work-desc">{clients[6].desc}</p>
                  <div className="work-services">
                    {clients[6].services.map(s => <span key={s}>{s}</span>)}
                  </div>
                </div>
              </article>
            </div>

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
              <h4>&raquo; Contact</h4>
              <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
              <a href="tel:+61447764477">0447 764 477</a>
              <p>56/21-25 Chambers Rd, Altona North VIC 3025</p>
            </div>
            <div className="footer-col">
              <h4>&raquo; Connect</h4>
              <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">Instagram</a>
              <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener">LinkedIn</a>
              <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener">TikTok</a>
              <a href="https://youtube.com/@mdmediapodcast" target="_blank" rel="noreferrer noopener">YouTube</a>
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
