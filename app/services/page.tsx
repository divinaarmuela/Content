import ScrollObserver from '../components/ScrollObserver'
import GradientHero from '../components/GradientHero'
import SiteFooter from '../components/SiteFooter'
import ScrambleEyebrow from '../components/ScrambleEyebrow'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

const services = [
  {
    idx: '01',
    name: 'Content Production',
    sub: 'Photo · video · copy',
    desc: 'Monthly shoots and editing produced in-house. One shoot feeds weeks of content across every channel.',
    href: '/content',
  },
  {
    idx: '02',
    name: 'Ongoing Marketing',
    sub: 'Strategy · social · ads · email',
    desc: 'Consistent marketing without the full-time hire. Content, campaigns, and reporting run by one pod.',
    href: '/marketing',
  },
  {
    idx: '03',
    name: 'Brand & Strategy',
    sub: 'Identity · messaging · positioning',
    desc: 'Logo, identity, messaging, and the full visual system that makes you look like the business you’re becoming.',
    href: '/branding',
  },
  {
    idx: '04',
    name: 'Personal Brand',
    sub: 'Voice · presence · inbound',
    desc: 'Voice positioning, monthly shoots, and a content system that generates qualified inbound leads.',
    href: '/personal-brand',
  },
  {
    idx: '05',
    name: 'Podcast Studio',
    sub: 'Recording · production · clips',
    desc: 'A full podcast pipeline: recording, editing, and the short-form clips that carry it across platforms.',
    href: '/podcast-studio',
  },
  {
    idx: '06',
    name: 'Website Optimisation',
    sub: 'Conversion · speed · SEO',
    desc: 'The place your content sends people. Built to convert the attention everything else earns.',
    href: '/website',
  },
]

export default function ServicesPage() {
  return (
    <>
      <main className="ed-main">
        <GradientHero
          asciiHands
          showMarquee={false}
          tag="· Services · Melbourne"
          headline={{
            base: <>One<span className="hl-hide"> team.<br />One</span> system.</>,
            mid: <><span className="hl-hide">One </span>team.<br />One<span className="hl-hide"> system.</span></>,
            blob: <>One team.<br />One system.</>,
          }}
          desc={
            <>
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
                  Six ways to work with us, all produced by the same
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
                  in-house crew. Start where the gap is biggest.
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

        <section className="ed-section">
          <div className="container">
            <ScrambleEyebrow text="· What we do ·" />
            <h2 className="ed-heading">Start with content. Scale into the rest.</h2>
            <p className="ed-lede">
              Every service runs on the same engine: strategy first, produced in-house, measured monthly.
              Most clients start with one and add the others as the numbers come in.
            </p>
            <div className="ed-rows fade-up">
              {services.map(s => (
                <a key={s.href} className="ed-row" href={s.href}>
                  <span className="ed-row-idx">{s.idx}</span>
                  <span className="ed-row-name">
                    {s.name}
                    <span className="ed-row-sub">{s.sub}</span>
                  </span>
                  <span className="ed-row-desc">{s.desc}</span>
                  <span className="ed-row-arw">↗︎</span>
                </a>
              ))}
            </div>
          </div>
        </section>

        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Not sure where to start?</p>
                <h2 className="cta-heading">
                  Ten minutes.<br />
                  We&apos;ll tell you <span className="blue">straight.</span>
                </h2>
                <p className="cta-sub">
                  A short call to map where the biggest gap is — content, brand, or distribution — and what closing it looks like.
                </p>
                <div className="cta-btns">
                  <a href={CALENDLY} className="btn" target="_blank" rel="noreferrer noopener">
                    Book a call <span className="arr">→</span>
                  </a>
                  <a href="http://scorecard.mdmmarketing.com.au" className="btn btn-outline" target="_blank" rel="noreferrer noopener">
                    Free diagnostic <span className="arr">→</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter vol="Services index" />
      <ScrollObserver />
    </>
  )
}
