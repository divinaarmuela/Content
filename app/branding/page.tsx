import BrandingForm from '../components/BrandingForm'
import ScrollObserver from '../components/ScrollObserver'

const problems = [
  {
    id: 'ERR_01',
    status: 'CONFUSED',
    heading: 'Your brand means different things to different people.',
    body: "Your website says one thing. Your socials say another. Your pitch deck is its own document entirely. Inconsistency is expensive — trust leaks out at every touch point.",
  },
  {
    id: 'ERR_02',
    status: 'COPYCAT',
    heading: 'You look like every competitor in your space.',
    body: "Same blue palette. Same sans serif. Same stock photography energy. The market can't tell you apart, so it defaults to price. That's a race you don't want to win.",
  },
  {
    id: 'ERR_03',
    status: 'DATED',
    heading: "Your brand hasn't grown with you.",
    body: "You've moved up. Your pricing's moved up. Your clients have moved up. Your brand is still where it was three years ago, and it's costing you credibility with the next tier.",
  },
]

const gains = [
  {
    no: '01',
    title: 'Clarity that ends the confusion.',
    body: 'One consistent story. One voice. One visual language. Your team stops guessing, your clients stop wondering, and your market stops comparing you to the wrong companies.',
  },
  {
    no: '02',
    title: 'Conviction in your premium.',
    body: 'A well-built brand justifies your price before the invoice lands. Prospects stop shopping on cost and start shopping on fit.',
  },
  {
    no: '03',
    title: 'A category of your own.',
    body: 'Instead of competing on features, you own a positioning. Instead of being one of many, you become the obvious answer to a specific question.',
  },
]

const phases = [
  { no: '01', name: 'Diagnose', desc: "We audit your brand, competitors, and audience. Map the gap between where you are and where the market needs you to be." },
  { no: '02', name: 'Define', desc: "Positioning, messaging, and narrative locked in. Who you are, who you serve, why it matters." },
  { no: '03', name: 'Design', desc: "Visual identity built around strategy. Logo, palette, type, imagery. Everything earns its place by reinforcing the position." },
  { no: '04', name: 'Deliver', desc: "Guidelines, templates, launch assets. Everything your team needs to roll out and stay consistent for years." },
]

const faqs = [
  { q: 'How long does a full brand build take?', a: "A complete brand strategy and identity build runs 6 to 10 weeks depending on scope. We deliver in stages so you can review and sign off before we move forward. No month-long silences. No black box." },
  { q: 'Do we get a logo, or a full brand system?', a: "Both. Every engagement includes strategy, visual identity (logo, typography, palette, imagery direction), messaging, and brand guidelines your team can execute from. A logo without a system is a drawing. We build systems." },
  { q: "What if we already have a logo we like?", a: "We work with what's working. Our Diagnose phase identifies what to keep, what to evolve, and what to retire. We don't rebuild for the sake of it. Sometimes the logo stays and the strategy around it gets a lot sharper." },
  { q: 'Can you make our brand work online and offline?', a: "Yes. Every brand we build is designed for the channels it'll actually live in. Digital first, print ready, social native. We stress-test it against the real world before we hand it over." },
  { q: 'What does it cost?', a: "Investment varies by scope and is discussed on the call after we understand the business. Brand Identity starts accessible for growing businesses. Full Brand Strategy is a real investment, priced for businesses ready to own their category." },
  { q: 'Do we own everything you create?', a: "All of it. Every file, every guideline, every system is yours forever. This is your brand we're building, not ours." },
]

export default function BrandingPage() {
  return (
    <>
      <main>

        {/* HERO */}
        <section className="hero">
          <div className="hero-bg">
            <img
              src="https://static.wixstatic.com/media/c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/c5a69a_4bc1ab98c0674462a67fea672a7a3d2a~mv2.jpg"
              alt=""
              aria-hidden="true"
            />
            <div className="hero-overlay" />
          </div>
          <div className="container hero-inner">
            <p className="hero-tagline">Brand Strategy &amp; Identity — Melbourne</p>
            <h1 className="hero-h1">
              Looking like everyone else<br />
              is a strategy too.<br />
              <span style={{ color: 'var(--blue)' }}>Just a bad one.</span>
            </h1>
            <p className="hero-desc">
              A brand isn&apos;t a logo. It&apos;s the reason someone picks you in a market of ten.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '36px', flexWrap: 'wrap' }}>
              <a href="#apply" className="btn">Start a Build <span className="arr">→</span></a>
              <a href="https://scorecard.mdmmarketing.com.au" className="btn btn-outline" target="_blank" rel="noreferrer noopener">Take the Scorecard <span className="arr">→</span></a>
            </div>
          </div>
        </section>

        {/* STATS STRIP */}
        <div className="stats-strip">
          <div className="container stats-inner">
            <div className="stat-item"><span className="stat-val">6–10</span><span className="stat-label">Weeks to build</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">4</span><span className="stat-label">Phase process</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">In-house</span><span className="stat-label">Strategy &amp; design</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val blue">Yours</span><span className="stat-label">Every file, forever</span></div>
          </div>
        </div>

        {/* MARQUEE */}
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            <span className="marquee-item">
              LOGO ≠ BRAND <span className="marquee-dot">●</span> STRATEGY BEFORE DESIGN{' '}
              <span className="marquee-dot">●</span> BUILT TO COMPOUND{' '}
              <span className="marquee-dot">●</span> POSITIONED TO WIN{' '}
              <span className="marquee-dot">●</span> OWN YOUR CATEGORY{' '}
              <span className="marquee-dot">●</span>
            </span>
            <span className="marquee-item">
              LOGO ≠ BRAND <span className="marquee-dot">●</span> STRATEGY BEFORE DESIGN{' '}
              <span className="marquee-dot">●</span> BUILT TO COMPOUND{' '}
              <span className="marquee-dot">●</span> POSITIONED TO WIN{' '}
              <span className="marquee-dot">●</span> OWN YOUR CATEGORY{' '}
              <span className="marquee-dot">●</span>
            </span>
          </div>
        </div>

        {/* STATEMENT */}
        <section className="brand-statement-section">
          <div className="container">
            <div className="brand-statement-inner fade-up">
              <p>
                The businesses that win aren&apos;t the ones that shout the loudest. They&apos;re the ones whose brand is so distinct,{' '}
                <span className="blue">choosing them feels obvious.</span>
              </p>
              <span className="brand-statement-attrib">A Thesis &middot; MD Media, Melbourne</span>
            </div>
          </div>
        </section>

        {/* PROBLEMS */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Where brands <span className="blue">lose ground.</span>
            </h2>
            <p className="section-lede">
              A weak brand doesn&apos;t fail loudly. It fails quietly, through lost deals, price pressure, and a market that can&apos;t tell you apart from the next name on the list.
            </p>
            <div className="diagnostic-grid">
              {problems.map((p, i) => (
                <div key={p.id} className={`diagnostic fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <div className="diag-head">
                    <span className="diag-id">{p.id}</span>
                    <span className="diag-status">{p.status}</span>
                  </div>
                  <h3>{p.heading}</h3>
                  <p>{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* THESIS */}
        <section className="thesis">
          <div className="container">
            <div className="thesis-grid">
              <div className="thesis-sidebar">
                // THESIS.BRAND
                <div className="meta">
                  ID: BRAND_AS_INFRA<br />
                  VER: 1.0<br />
                  BY: MD Media
                </div>
              </div>
              <div className="thesis-body">
                <h2>
                  A strong brand isn&apos;t decoration.{' '}
                  <span className="blue">It&apos;s infrastructure.</span>
                </h2>
                <p>
                  Brand is the first thing a prospect sees and the last thing they remember. It sets the price they&apos;ll pay, the speed they&apos;ll buy at, and whether they refer you to anyone else.
                </p>
                <p>
                  Done well, brand compounds. Every touch point reinforces the last. Every campaign gets cheaper because the trust is already there. Every pitch gets easier because the market already knows what you stand for.
                </p>
                <p>
                  That&apos;s not vanity. <strong>That&apos;s leverage.</strong>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* GALLERY */}
        <section className="gallery-section" aria-label="Brand work">
          <div className="gallery-head">
            <span className="left">&middot; SELECTED BRAND WORK</span>
            <span>MDM_STUDIO / 2024 &ndash; 2026</span>
          </div>
          <div className="gallery-grid">
            {[
              'c5a69a_6f5585879dda4f0fa31d352ce2e612cb~mv2.jpg',
              'c5a69a_cb9a54ad31dd4061b2e52c45e33cd36c~mv2.jpg',
              'c5a69a_301debe79d924d1485598c4f5f601013~mv2.jpg',
              'c5a69a_8ff71d938a1447a1b0987a2bb9272b1c~mv2.jpg',
            ].map((img, i) => (
              <div key={img} className="gallery-item">
                <img src={`https://static.wixstatic.com/media/${img}`} alt="MD Media brand work" loading="lazy" />
                <span className={`gallery-cap${i % 2 === 1 ? ' blue' : ''}`}>PLT_0{i + 1}</span>
              </div>
            ))}
          </div>
        </section>

        {/* WHAT YOU GET */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Clarity, conviction, <span className="blue">category.</span>
            </h2>
            <p className="section-lede">
              Brand isn&apos;t what you say about yourself. It&apos;s what happens in your market when you&apos;re not in the room.
            </p>
            <div className="timeline">
              {gains.map((g, i) => (
                <div key={g.no} className={`timeline-row fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <span className="t-num">{g.no}</span>
                  <span className="t-name">{g.title}</span>
                  <span className="t-desc">{g.body}</span>
                  <span className="t-time">Outcome</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TWO OFFERS */}
        <section id="offers">
          <div className="container">
            <h2 className="section-title">
              Pick the <span className="blue">depth of build.</span>
            </h2>
            <p className="section-lede">
              Whether you&apos;re starting fresh or levelling up, both paths deliver a brand your team can execute from, with confidence.
            </p>
            <div className="models-grid">
              <div className="model fade-up">
                <div className="model-meta">
                  <span className="model-id">BUILD_01</span>
                  <span className="model-type">Standard</span>
                </div>
                <h3>Brand <span className="blue">Identity</span></h3>
                <div className="model-desc">
                  For businesses who need a complete visual identity, fast.{' '}
                  <strong>Everything your team needs to look unified from day one.</strong>
                </div>
                <ul>
                  <li>Brand discovery workshop</li>
                  <li>Logo system (primary, secondary, mark)</li>
                  <li>Typography and colour palette</li>
                  <li>Imagery and iconography direction</li>
                  <li>Brand guidelines document</li>
                  <li>Applied templates (social, deck, email)</li>
                </ul>
                <div className="model-footer">3 to 5 weeks &middot; Scope to business</div>
              </div>
              <div className="model dark fade-up d1">
                <div className="model-meta">
                  <span className="model-id">BUILD_02</span>
                  <span className="model-type">Full Build — Most Chosen</span>
                </div>
                <h3>Full Brand <span className="blue">Strategy</span></h3>
                <div className="model-desc">
                  For businesses serious about owning a category.{' '}
                  <strong>The complete build your whole business runs on for 5+ years.</strong>
                </div>
                <ul>
                  <li>Everything in Brand Identity</li>
                  <li>Competitive audit and positioning map</li>
                  <li>Ideal client deep dive and personas</li>
                  <li>Brand narrative and story framework</li>
                  <li>Messaging hierarchy and tone of voice</li>
                  <li>Launch and rollout plan</li>
                </ul>
                <div className="model-footer">6 to 10 weeks &middot; Quoted per scope</div>
              </div>
            </div>
          </div>
        </section>

        {/* PROCESS */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Four phases. <span className="blue">One brand.</span>
            </h2>
            <p className="section-lede">Strategy first. Design second. In that order, every time.</p>
            <div className="timeline">
              {phases.map((ph, i) => (
                <div key={ph.no} className={`timeline-row fade-up${i > 0 ? ` d${Math.min(i, 3)}` : ''}`}>
                  <span className="t-num">{ph.no}</span>
                  <span className="t-name">{ph.name}</span>
                  <span className="t-desc">{ph.desc}</span>
                  <span className="t-time">Phase {ph.no}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FIT CHECK */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Built, <span className="blue">not painted.</span>
            </h2>
            <div className="filter-grid">
              <div className="filter-col yes">
                <h3><span>This is for you, if</span><span className="status">● FIT</span></h3>
                <ul className="filter-list">
                  <li>You&apos;re launching something new and want to get it right the first time.</li>
                  <li>You&apos;ve outgrown your current brand and it&apos;s costing you credibility.</li>
                  <li>You want strategy before design, not design for design&apos;s sake.</li>
                  <li>You see brand as an investment that compounds for years.</li>
                  <li>You want to own a category, not rent a look.</li>
                </ul>
              </div>
              <div className="filter-col no">
                <h3><span>It&apos;s not a fit, if</span><span className="status">○ SKIP</span></h3>
                <ul className="filter-list">
                  <li>You want a logo in a week with no strategy behind it.</li>
                  <li>You want to pick a look from a template gallery.</li>
                  <li>You aren&apos;t willing to sit in the discovery phase.</li>
                  <li>You want the cheapest option, not the right one.</li>
                  <li>You see brand as decoration, not infrastructure.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ABOUT */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Lived on <span className="blue">both sides</span> of the camera.
            </h2>
            <div className="about-grid">
              <div className="about-image">
                <img
                  src="https://static.wixstatic.com/media/c5a69a_e14751cecceb4b1591d395ec8f2ea5dc~mv2.jpg"
                  alt="Divina Armuela and Martin Kormushoski, co-founders of MD Media Marketing"
                  loading="lazy"
                />
                <div className="about-image-cap">
                  <span>PORTRAIT.BRAND</span>
                  <span className="blue">MDM_FOUNDERS</span>
                </div>
              </div>
              <div className="about-text">
                <p>
                  Most brand agencies start with a mood board. We start with a question: why should anyone choose you over the next five people saying the same thing?
                </p>
                <p>
                  Divina&apos;s background is in psychographics and human behaviour — studying what makes people follow, trust, and buy. Every brand she builds starts from the inside out. The belief, the positioning, the language, before a single colour is chosen.
                </p>
                <p>
                  Martin trained his eye through production and design, obsessing over what makes something feel considered. His role is translating strategy into a visual language that doesn&apos;t just look good — it holds up under scrutiny.
                </p>
                <p>
                  Together they&apos;ve built brands across finance, hospitality, real estate, automotive, construction, and personal brands. Every one starts with strategy, ends with a system, and is designed to compound for years, not trend for a season.
                </p>
                <span className="founders-sig">
                  Divina Armuela <span className="divide">//</span> Martin Kormushoski
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section>
          <div className="container">
            <h2 className="section-title">
              Straight, <span className="blue">not spun.</span>
            </h2>
            <div className="faq-static">
              {faqs.map((item, i) => (
                <div key={i} className="faq-static-item">
                  <div className="faq-static-q">
                    <span className="faq-static-num">{String(i + 1).padStart(2, '0')}</span>
                    <span>{item.q}</span>
                  </div>
                  <p className="faq-static-a">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* APPLY */}
        <section className="apply" id="apply">
          <div className="container">
            <h2 className="section-title">
              Stop blending in. <span className="blue">Start being chosen.</span>
            </h2>
            <p className="section-lede">
              Limited monthly intake. Tell us about your brand and we&apos;ll be in touch.
            </p>
            <BrandingForm />
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
                Strategy. Identity. Clarity.<br />
                Brands built to compound, not trend.
              </div>
            </div>
            <div className="footer-col">
              <h4>&raquo; Services</h4>
              <a href="/content">Content Production</a>
              <a href="/podcast-studio">Podcast Studio</a>
              <a href="/marketing">Ongoing Marketing</a>
              <a href="/website">Website Optimisation</a>
              <a href="/branding">Brand Strategy</a>
              <a href="/personal-brand">Personal Brand</a>
            </div>
            <div className="footer-col">
              <h4>&raquo; Office</h4>
              <p>56/21-25 Chambers Rd</p>
              <p>Altona North VIC 3025</p>
              <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
              <a href="tel:+61447764477">0447 764 477</a>
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
            <span>Vol. 01 // Brand Strategy</span>
          </div>
        </div>
      </footer>

      <ScrollObserver />
    </>
  )
}
