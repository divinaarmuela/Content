import PersonalBrandForm from '../components/PersonalBrandForm'
import ScrollObserver from '../components/ScrollObserver'

const problems = [
  {
    no: '01 / Invisible',
    title: 'Content keeps getting bumped.',
    body: 'Weeks pass. Your audience forgets you exist. The founders showing up consistently are winning the trust that should be yours.',
  },
  {
    no: '02 / Unsure',
    title: "You don't know how to show up.",
    body: "You know you should be putting yourself out there. You don't know what to say, where to start, or how to make it feel like you. So you don't.",
  },
  {
    no: '03 / Forgettable',
    title: 'Everyone looks the same online.',
    body: "In a market where everyone has access to the same tools, the founder with a real voice wins the deals. The one who doesn't gets scrolled past.",
  },
]

const gains = [
  {
    no: '01',
    title: 'Conviction in your positioning.',
    body: "You stop second-guessing your message. Your audience stops second-guessing you. The clarity of your voice becomes the clarity of your business.",
  },
  {
    no: '02',
    title: 'Trust that precedes the pitch.',
    body: "People show up to calls already knowing who you are and why you're worth working with. The selling gets easier because the trust is already there.",
  },
  {
    no: '03',
    title: 'A brand your business borrows from.',
    body: "When people trust you, they trust your business. Your name becomes shorthand for quality, and every offer you launch benefits from the equity you've built.",
  },
]

const callItems = [
  {
    no: '01',
    title: 'Voice & positioning clarity',
    body: "We identify what makes you different and how to turn that into content no one else can replicate.",
  },
  {
    no: '02',
    title: 'A personal brand roadmap',
    body: "Not a content calendar. A strategic plan for how your voice becomes your most valuable business asset.",
  },
  {
    no: '03',
    title: 'A clear next step',
    body: "You'll leave knowing exactly what to do, whether you work with us or not.",
  },
]

const faqs = [
  {
    q: 'Why not just do it myself with ChatGPT?',
    a: "You can. And the founders who do it well spend 15+ hours a week on it and still sound like everyone else. We're not here to replace your voice. We're here to build the system around it so it scales without costing you your calendar.",
  },
  {
    q: "I'm camera shy. Is this even for me?",
    a: "Most of our founders were, on day one. Our studio and shoot process is built to pull out the real version of you, not polish you into someone you're not. You won't feel like you're performing. You'll feel like you're talking.",
  },
  {
    q: 'How much of my time will this take?',
    a: "A half-day shoot each month, plus short strategy check-ins. That's it. The rest is ours. We built this for founders running businesses, not creators looking for a full-time content job.",
  },
  {
    q: 'How long until it starts working?',
    a: "Month one is voice, positioning, and first shoot. By month two, content is live and compounding. By month three, you have early signal. Real personal brand is a 6 to 12 month build, not a 30-day sprint.",
  },
  {
    q: 'What does it cost?',
    a: "Investment is discussed on the call, after we understand your business and what you actually need. We're not the cheapest option. We're the one that treats your brand like the asset it is.",
  },
  {
    q: 'Do I own the content and strategy?',
    a: "All of it. Every asset, every strategy doc, every system we build is yours forever. This is your brand we're building, not ours.",
  },
]

export default function PersonalBrandPage() {
  return (
    <>
      <main>

        {/* HERO — full bleed dark, same pattern as other pages */}
        <section className="hero">
          <div className="hero-bg">
            <img
              src="https://static.wixstatic.com/media/c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg/v1/fill/w_1920,h_1080,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/c5a69a_ad4957b0df6b4257b3a20ac240a39348~mv2.jpg"
              alt=""
              aria-hidden="true"
            />
            <div className="hero-overlay" />
          </div>
          <div className="container hero-inner">
            <p className="hero-tagline">Founder Personal Brand — Melbourne</p>
            <h1 className="hero-h1">
              AI can write.<br />
              <span style={{ color: 'var(--blue)' }}>It can&apos;t be you.</span>
            </h1>
            <p className="hero-desc">
              Every market is saturated. Every competitor has access to the same tools, the same AI, the same playbook. The only thing that can&apos;t be replicated is your voice.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '36px', flexWrap: 'wrap' }}>
              <a href="#apply" className="btn">Book your session <span className="arr">→</span></a>
              <a href="https://scorecard.mdmmarketing.com.au" className="btn btn-outline" target="_blank" rel="noreferrer noopener">Take the scorecard <span className="arr">→</span></a>
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* STATEMENT */}
        <section className="pb-statement">
          <div className="container">
            <p>
              Every market is saturated. Every competitor has access to the same tools, the same AI, the same playbook.{' '}
              <strong>The only thing that can&apos;t be replicated, automated, or outspent is your voice.</strong>{' '}
              Your personal brand is the last real competitive advantage you have.{' '}
              <span className="blue">And most founders are leaving it on the table.</span>
            </p>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* PROBLEM */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">The quiet cost</span>
            <h2 className="pb-h2">Where founders <span className="blue">lose ground.</span></h2>
            <p className="pb-lead">
              Your expertise isn&apos;t the problem. Your positioning is. And every week it stays unclear is a week your market is deciding you don&apos;t exist.
            </p>
            <div className="pb-problems">
              {problems.map((p, i) => (
                <div key={p.no} className={`pb-problem-card fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <span className="pb-problem-num">{p.no}</span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* SHIFT */}
        <section className="pb-shift">
          <div className="container">
            <span className="pb-eyebrow">The shift</span>
            <h2 className="pb-h2">Personal brand isn&apos;t vanity. <span className="blue">It&apos;s strategy.</span></h2>
            <div className="pb-essay">
              <p>The founders winning right now aren&apos;t the ones with the best product. They&apos;re the ones people trust before the first sales call even happens.</p>
              <p>That trust comes from one place: showing up consistently with a point of view only you can have. Not polished corporate content. Not AI slop. Real perspective from someone in the arena.</p>
              <p>Your personal brand is what makes people choose you over the other ten options that look identical on paper. It&apos;s the reason someone replies to your DM, opens your email, or refers you without being asked.</p>
            </div>
          </div>
        </section>

        {/* GALLERY */}
        <section className="pb-gallery">
          <div className="pb-gallery-grid">
            <div className="pb-plate">
              <img src="https://static.wixstatic.com/media/c5a69a_cd13a9d93dc546688cbc2bea09b5f479~mv2.jpg" alt="Founder portrait" loading="lazy" />
            </div>
            <div className="pb-plate pb-plate-wide">
              <img src="https://static.wixstatic.com/media/c5a69a_e0930420116743938928fde790433fbd~mv2.jpg" alt="Studio work" loading="lazy" />
            </div>
            <div className="pb-plate">
              <img src="https://static.wixstatic.com/media/c5a69a_116253b36d02423cbbb7ea79d7a5819d~mv2.jpg" alt="Founder in studio" loading="lazy" />
            </div>
          </div>
        </section>

        {/* GAINS */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">What personal brand actually builds</span>
            <h2 className="pb-h2">Reinforcement, <span className="blue">not reach.</span></h2>
            <p className="pb-lead">
              Personal brand isn&apos;t a growth hack. It&apos;s the reinforcement layer that makes everything else you do work harder — your sales calls, your offers, your referrals, your hiring.
            </p>
            <div className="pb-gains">
              {gains.map((g, i) => (
                <div key={g.no} className={`pb-gain fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <span className="pb-gain-num">{g.no}</span>
                  <h3>{g.title}</h3>
                  <p>{g.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* OFFERS */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">Two ways to work with us</span>
            <h2 className="pb-h2">Pick the <span className="blue">level of build.</span></h2>
            <p className="pb-lead">
              Both paths run through the same strategic foundation. The difference is how much of the engine you want us to run.
            </p>
            <div className="models-grid">
              <div className="model fade-up">
                <div className="model-meta">
                  <span className="model-id">BUILD_01</span>
                  <span className="model-type">Standard</span>
                </div>
                <h3>Strategy + <span className="blue">Content</span></h3>
                <div className="model-desc">
                  For founders with an internal team who need the playbook and the assets. We build the voice, the strategy, and the content.{' '}
                  <strong>Your team handles distribution.</strong>
                </div>
                <ul>
                  <li>Personal brand strategy and voice positioning</li>
                  <li>Content pillars mapped to your expertise</li>
                  <li>Monthly founder content shoots</li>
                  <li>Professional editing and post production</li>
                  <li>Content calendar and hook library</li>
                  <li>Quarterly strategy reviews</li>
                </ul>
                <div className="model-footer">Min. 3 months &middot; Scope to founder</div>
              </div>
              <div className="model dark fade-up d1">
                <div className="model-meta">
                  <span className="model-id">BUILD_02</span>
                  <span className="model-type">Full Management — Most Chosen</span>
                </div>
                <h3>Full <span className="blue">Management</span></h3>
                <div className="model-desc">
                  For founders ready to hand off the entire brand engine.{' '}
                  <strong>You show up for the shoot. We do the rest.</strong>
                </div>
                <ul>
                  <li>Everything in Strategy + Content</li>
                  <li>Multi-platform management</li>
                  <li>Paid amplification on your best content</li>
                  <li>Email and newsletter management</li>
                  <li>Weekly reporting and optimisation</li>
                  <li>Dedicated account manager and pod</li>
                </ul>
                <div className="model-footer">Min. 3 months &middot; Scope to founder</div>
              </div>
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* THE CALL */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">In the call</span>
            <h2 className="pb-h2">What happens when <span className="blue">we talk.</span></h2>
            <p className="pb-lead">
              One call. That&apos;s where it starts. We dig into your positioning, your voice, and your market — and map out what your personal brand strategy should look like. No templates. No &ldquo;just be authentic&rdquo; advice.
            </p>
            <div className="pb-call-grid">
              {callItems.map((c, i) => (
                <div key={c.no} className={`pb-call-item fade-up${i > 0 ? ` d${i}` : ''}`}>
                  <span className="pb-gain-num">{c.no}</span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* WHO FOR */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">Honest filter</span>
            <h2 className="pb-h2">We work with founders who <span className="blue">refuse to blend in.</span></h2>
            <p className="pb-lead">
              AI levelled the playing field on production. The only edge left is personality, perspective, and presence. We help you turn those into a system.
            </p>
            <div className="filter-grid">
              <div className="filter-col yes">
                <h3><span>This is for you if</span><span className="status">● FIT</span></h3>
                <ul className="filter-list">
                  <li>You have real expertise and a point of view the market needs to hear</li>
                  <li>You want your name to open doors, not just your business name</li>
                  <li>You&apos;re ready to show up consistently, not chase virality</li>
                  <li>You see brand as a long-term asset, not a campaign</li>
                  <li>You want strategy behind every piece of content</li>
                </ul>
              </div>
              <div className="filter-col no">
                <h3><span>It&apos;s not a fit if</span><span className="status">○ SKIP</span></h3>
                <ul className="filter-list">
                  <li>You want us to fake a voice that isn&apos;t yours</li>
                  <li>You expect viral growth in 30 days</li>
                  <li>You&apos;re not willing to show up for strategy and shoots</li>
                  <li>You&apos;d rather AI wrote everything for you</li>
                  <li>You see personal brand as a vanity project</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* ABOUT */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">The founders</span>
            <h2 className="pb-h2">Built by people who&apos;ve lived on <span className="blue">both sides of the camera.</span></h2>
            <div className="about-grid">
              <div className="about-image">
                <img
                  src="https://static.wixstatic.com/media/c5a69a_e14751cecceb4b1591d395ec8f2ea5dc~mv2.jpg"
                  alt="Divina and Martin, co-founders of MD Media"
                  loading="lazy"
                />
                <div className="about-image-cap">
                  <span>PORTRAIT.PB</span>
                  <span className="blue">MDM_FOUNDERS</span>
                </div>
              </div>
              <div className="about-text">
                <p>Most agencies are built by marketers. We&apos;re not.</p>
                <p>Divina spent years understanding what makes people follow, trust, and buy — not from a textbook, but from being in the world of influence and watching human behaviour up close.</p>
                <p>Martin built his eye through media and production, learning what makes someone stop, stay, and feel something.</p>
                <p>When they came together, MD Media was the only logical outcome. A studio that doesn&apos;t just produce content — it understands the psychology behind why content works.</p>
                <p>Today, MD Media runs content ecosystems with a team of 15 for founders across finance, hospitality, real estate, health, automotive, and personal brands. Everything stays in-house.</p>
                <span className="founders-sig">
                  Divina Armuela <span className="divide">//</span> Martin Kormushoski
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="pb-divider"><div /></div>

        {/* FAQ */}
        <section>
          <div className="container">
            <span className="pb-eyebrow">Straight answers</span>
            <h2 className="pb-h2">The questions you&apos;re <span className="blue">actually thinking.</span></h2>
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

        {/* APPLY — navy background */}
        <section className="pb-apply" id="apply">
          <div className="container">
            <span className="pb-eyebrow" style={{ color: 'rgba(247,244,238,0.55)' }}>Limited monthly intake</span>
            <h2 className="pb-h2" style={{ color: 'var(--bg)', maxWidth: '760px' }}>
              In a world full of AI content, be the one people{' '}
              <span style={{ color: '#FF5C00' }}>actually remember.</span>
            </h2>
            <p className="pb-lead" style={{ color: 'rgba(247,244,238,0.7)' }}>
              While most founders outsource their voice to ChatGPT and wonder why nothing lands, the ones building real personal brands are pulling away from the pack. Tell us about you and we&apos;ll be in touch.
            </p>
            <PersonalBrandForm />
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
                Your voice is the only thing AI can&apos;t copy.<br />
                Build it like the asset it is.
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
              <a href="/">Main site</a>
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
            <span>Founder Personal Brand</span>
          </div>
        </div>
      </footer>

      <ScrollObserver />
    </>
  )
}
