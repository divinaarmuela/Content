import ScrollObserver from '../components/ScrollObserver'
import GradientHero from '../components/GradientHero'
import SiteFooter from '../components/SiteFooter'
import ScrambleEyebrow from '../components/ScrambleEyebrow'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const beliefs = [
  {
    num: '01',
    title: 'Psychology before production',
    body: 'Content works when it understands why people follow, trust, and buy. The camera comes second.',
  },
  {
    num: '02',
    title: 'Everything in-house',
    body: 'Same crew every time. No rotating freelancers, no outsourced editing, no quality drift between months.',
  },
  {
    num: '03',
    title: 'Systems over one-offs',
    body: 'A viral post is luck. A content system that compounds month after month is a business asset.',
  },
  {
    num: '04',
    title: 'Numbers you can check',
    body: 'Every engagement is measured and reported. You see the data and the decisions, not just the deliverables.',
  },
]

export default function AboutPage() {
  return (
    <>
      <main className="ed-main">
        <GradientHero
          asciiHands
          showMarquee={false}
          tag="· Behind MD Media · Est. 2024"
          headline={{
            base: <>Built<span className="hl-hide"> by people from<br />both sides of the</span> camera.</>,
            mid: <><span className="hl-hide">Built </span>by people from<br />both sides of the<span className="hl-hide"> camera.</span></>,
            blob: <>Built by people from<br />both sides of the camera.</>,
          }}
          desc={
            <>
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
                  Most agencies are built by marketers.
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
                  We&apos;re built by people who&apos;ve lived in front of the
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.76s' }}>
                  lens and behind it.
                </span>
              </span>
            </>
          }
          actions={
            <a href={CALENDLY} target="_blank" rel="noreferrer noopener" className="hero-glow-btn hero-glow-btn-sharp hero-glow-btn-pulse">
              Book a strategy call
              <span className="btn-pulse-dot" aria-hidden="true"></span>
            </a>
          }
        />

        {/* FOUNDING STORY */}
        <section className="ed-section">
          <div className="container">
            <div className="abt-story">
              <div className="abt-story-text fade-up">
                <ScrambleEyebrow text="· The story ·" />
                <h2 className="ed-heading">Building brands that actually grow.</h2>
                <p>
                  <strong>Divina</strong> spent years understanding what makes people follow, trust, and buy.
                  Not from a textbook — from being in the world of influence and watching human behaviour up close.
                </p>
                <p>
                  <strong>Martin</strong> built his eye through media and production, learning what makes someone
                  stop, stay, and feel something.
                </p>
                <p>
                  When they came together in late 2024, MD Media was the only logical outcome: a studio that
                  doesn&apos;t just produce content — it understands the psychology behind why content works.
                </p>
                <p>
                  Today, MD Media runs content ecosystems with a team of 15 for businesses across finance,
                  hospitality, real estate, health, automotive, and personal brands. From strategy to the final
                  frame, everything stays in-house.
                </p>
              </div>
              <div className="fade-up d1">
                <div className="abt-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/martindivina.avif" alt="Divina Armuela and Martin Kormushoski, co-founders of MD Media" />
                </div>
                <p className="abt-photo-cap">Divina Armuela &amp; Martin Kormushoski · Co-founders</p>
              </div>
            </div>
          </div>
        </section>

        {/* STATS */}
        <div className="stats-strip">
          <div className="container stats-inner">
            <div className="stat-item"><span className="stat-val">15</span><span className="stat-label">In-house team</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">17</span><span className="stat-label">Active retainers</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val">6</span><span className="stat-label">Industries</span></div>
            <div className="stat-div" />
            <div className="stat-item"><span className="stat-val blue">2024</span><span className="stat-label">Est. Melbourne</span></div>
          </div>
        </div>

        {/* BELIEFS */}
        <section className="ed-section">
          <div className="container">
            <ScrambleEyebrow text="· What we believe ·" />
            <h2 className="ed-heading">The rules the studio runs on.</h2>
            <div className="abt-beliefs">
              {beliefs.map((b, i) => (
                <div key={b.num} className={`abt-belief fade-up${i > 0 ? ` d${Math.min(i, 3)}` : ''}`}>
                  <span className="abt-belief-num">{b.num}</span>
                  <h3>{b.title}</h3>
                  <p>{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Sound like your kind of team?</p>
                <h2 className="cta-heading">
                  Come see how<br />
                  we <span className="blue">work.</span>
                </h2>
                <p className="cta-sub">
                  Ten minutes on a call, or start with the free diagnostic and we&apos;ll review where you stand.
                </p>
                <div className="cta-btns">
                  <a href={CALENDLY} className="btn" target="_blank" rel="noreferrer noopener">
                    Book a call <span className="arr">→</span>
                  </a>
                  <a href="/work" className="btn btn-outline">
                    See the work <span className="arr">→</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter vol="Behind MD Media" tagline={<>Built by people from<br />both sides of the camera.</>} />
      <ScrollObserver />
    </>
  )
}
