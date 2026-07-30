import { Target, Clapperboard, Share2, Megaphone, Mail, BarChart3 } from 'lucide-react'
import ScrollObserver from '../components/ScrollObserver'
import GradientHero from '../components/GradientHero'
import ServiceList from '../components/ServiceList'
import ServiceShowcase from '../components/ServiceShowcase'
import ServiceAbout from '../components/ServiceAbout'
import ServiceCta from '../components/ServiceCta'
import SiteFooter from '../components/SiteFooter'

const ICON = { color: '#fff', strokeWidth: 1.6 } as const

const modules = [
  { title: 'Strategy & Pillars', icon: <Target {...ICON} />, desc: 'Quarterly direction set in advance. Every piece of content maps to a business outcome, not a posting schedule. You stop guessing what to make.' },
  { title: 'Production', icon: <Clapperboard {...ICON} />, desc: 'Monthly shoots and editing produced in-house. One shoot feeds weeks of content across every channel. Photo, video, and graphics from the same crew.' },
  { title: 'Social Management', icon: <Share2 {...ICON} />, desc: 'Instagram, TikTok, LinkedIn, YouTube. Posting, captions, engagement, and community, all tracked, optimised, and consistent week after week.' },
  { title: 'Paid Ads', icon: <Megaphone {...ICON} />, desc: 'Your best-performing organic becomes paid. Retargeting, lead-gen, and conversion campaigns built and managed on Meta and Google.' },
  { title: 'Email & Nurture', icon: <Mail {...ICON} />, desc: 'Newsletters, welcome flows, and sales sequences. Email that earns its open rate and keeps your pipeline warm between shoots.' },
  { title: 'Reporting', icon: <BarChart3 {...ICON} />, desc: 'A monthly review of what worked, what did not, and what we test next. You see the data and the decisions, not just the deliverables.' },
]

const cadence = [
  { phase: 'Month 01', title: 'Foundation', desc: 'Strategy session, brand deep-dive, content pillars, and a 90-day roadmap. We get access to analytics, platforms, and past performance.' },
  { phase: 'Month 01', title: 'First Production', desc: 'First shoot, scripts locked, visual direction confirmed. Platforms audited and the content calendar pre-loaded before anything goes live.' },
  { phase: 'Month 02', title: 'Content Live', desc: 'Content rolls out across every contracted channel. Community management active. The first round of learnings feeds straight back into strategy.' },
  { phase: 'Month 03', title: 'Data to Scale', desc: 'First full reporting cycle. We show what is working and what the next 90 days look like. Ads dialled in on evidence, not guesses.' },
]

export default function MarketingPage() {
  return (
    <>
      <main>
        <GradientHero
          asciiHands
          tag="· Ongoing Marketing · Melbourne"
          headline={{
            base: <>Consistent<span className="hl-hide"> marketing,<br />without the full-time<br /></span>hire.</>,
            mid: <><span className="hl-hide">Consistent </span>marketing,<br />without the full-time<br /><span className="hl-hide">hire.</span></>,
            blob: <>Consistent marketing,<br />without the full-time<br />hire.</>,
          }}
          desc={
            <>
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
                  Agencies deliver posts. We deliver a system.
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
                  Content, campaigns, and reporting, run by one
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.76s' }}>
                  pod that already works together.
                </span>
              </span>
            </>
          }
          actions={
            <>
              <a href="#contact" className="hero-glow-btn hero-glow-btn-sharp">
                Start a retainer
              </a>
              <a
                href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone"
                target="_blank"
                rel="noreferrer noopener"
                className="hero-glow-btn hero-glow-btn-sharp hero-glow-btn-pulse"
              >
                Book a call
                <span className="btn-pulse-dot" aria-hidden="true"></span>
              </a>
            </>
          }
        />

        <ServiceList headerTag="Everything your retainer runs" items={modules} />

        <ServiceShowcase
          eyebrow="· How It Works"
          heading={<>From zero to a running system.</>}
          items={cadence}
        />

        <ServiceAbout
          eyebrow="· Behind MD Media"
          heading={<>Run by operators, not just marketers.</>}
          image="/martindivina.avif"
          imageAlt="Divina Armuela and Martin Kormushoski, co-founders of MD Media"
          paragraphs={[
            <>Most agencies are built by marketers. We are not. Divina and Martin come from the other side of the business: one from content and psychographics, one from production and design.</>,
            <>The team of 15 they have built runs on a pod model. You work with the same five people every month: strategist, producer, editor, account lead, and analyst. No rotating freelancers.</>,
            <>Today MD Media runs ongoing marketing for 17 active retainers across finance, hospitality, real estate, health, automotive, and construction. Most clients stay 12+ months.</>,
          ]}
        />

        <ServiceCta
          ready="Ready?"
          sub="Limited monthly intake: three new retainers onboarded a month so every pod gets real attention. Tell us about your business and we'll be in touch."
          buttonLabel="Or Just Say Hello"
        />
      </main>

      <SiteFooter
        vol="Vol. 02 // Ongoing Marketing"
        tagline={<>Strategy. Production. Distribution.<br />Built in-house for businesses that can&apos;t afford to go quiet.</>}
      />

      <ScrollObserver />
    </>
  )
}
