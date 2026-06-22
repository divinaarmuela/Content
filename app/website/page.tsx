import { Layout, MousePointerClick, Search, PenLine, Gauge, LineChart } from 'lucide-react'
import ScrollObserver from '../components/ScrollObserver'
import GlowHero from '../components/GlowHero'
import ServiceList from '../components/ServiceList'
import ServiceShowcase from '../components/ServiceShowcase'
import ServiceAbout from '../components/ServiceAbout'
import ServiceCta from '../components/ServiceCta'
import SiteFooter from '../components/SiteFooter'

const ICON = { color: '#fff', strokeWidth: 1.6 } as const

const capabilities = [
  { title: 'Bespoke, From Scratch', icon: <Layout {...ICON} />, desc: 'No themes, no template lock-in, no two MD Media sites that look alike. Built from a blank canvas and customised to the last pixel, so the site is unmistakably yours.' },
  { title: 'Built to Convert', icon: <MousePointerClick {...ICON} />, desc: 'Every section is engineered around the action you want and then tested. We do not ship pretty pages, we ship pages that turn browsers into buyers and clicks into enquiries.' },
  { title: 'SEO That Compounds', icon: <Search {...ICON} />, desc: 'Found, not buried. Technical SEO and clean structure baked in from the first build, so you climb the rankings and compound traffic while competitors pay for every click.' },
  { title: 'Copy That Sells', icon: <PenLine {...ICON} />, desc: 'Headlines, page copy, and microcopy written against the sale, not the word count. The same team that scripts your content writes the site, so every line earns its place.' },
  { title: 'Fast By Default', icon: <Gauge {...ICON} />, desc: 'Sub-second loads, optimised media, and green Core Web Vitals. A site that lags loses the visitor before the first scroll, and Google notices, so we build for speed from day one.' },
  { title: 'Fully Trackable', icon: <LineChart {...ICON} />, desc: 'Events, goals, and pixels wired up properly from launch, so you see exactly what converts and the ads team can retarget everyone who did not. Decisions on data, not gut feel.' },
]

const process = [
  { phase: 'Step 01', title: 'Discovery & Strategy', desc: 'Starting fresh or rebuilding, we map your goals, audience, and competitors, then agree the pages, structure, and outcomes before a single screen is designed.' },
  { phase: 'Step 02', title: 'Design From Scratch', desc: 'Custom wireframes to high-fidelity design, fully bespoke to your brand. Built on whatever fits, WordPress, Shopify, Squarespace, or fully custom, with copy written into the layout.' },
  { phase: 'Step 03', title: 'Build & Launch', desc: 'Hand-built, then cross-device tested, speed-passed, SEO-checked, and analytics-wired before a clean launch. No broken links, no missing redirects, no surprises.' },
  { phase: 'Step 04', title: 'Optimise & Scale', desc: 'Post-launch we watch the data, test what converts, and refine. Plug the site into a content or marketing retainer and it keeps compounding, month after month.' },
]

export default function WebsitePage() {
  return (
    <>
      <main>
        <GlowHero
          tag="Website Design & Optimisation · Melbourne"
          lead="Websites"
          mid={<> that sell,<br />not just </>}
          trail="sit."
          desc={<>Bespoke sites, built from scratch and customised to the last pixel. Design, SEO, copy, and conversion, engineered to turn visitors into customers on any platform.</>}
          actions={
            <>
              <a href="#contact" className="hero-glow-btn hero-glow-btn-sharp">
                Start your build
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

        <ServiceList headerTag="Custom-built, end to end" items={capabilities} />

        <ServiceShowcase
          eyebrow="· How It Works"
          heading={<>From blank canvas to a site that sells.</>}
          items={process}
        />

        <ServiceAbout
          eyebrow="· Why It Works"
          heading={<>Built to sell, by the team that fills it.</>}
          image="/martindivina.avif"
          imageAlt="Divina Armuela and Martin Kormushoski, co-founders of MD Media"
          paragraphs={[
            <>Most agencies hand a website to a developer who never sees the content that goes on it. We build the site and produce the photos, video, and copy that fill it, so the design is made for real assets, not lorem ipsum.</>,
            <>That means a launch that already looks finished, and pages built around the way you actually sell. The conversion thinking comes from running ads and content for 17 retainers, not from a template.</>,
            <>And because the same team stays on, the site is not a one-off handoff. It plugs into your content and marketing, and keeps getting sharper as the data comes in.</>,
          ]}
        />

        <ServiceCta
          ready="Ready?"
          sub="Tell us where your site is falling short and what it needs to do. We'll scope the build and be in touch with a clear plan."
          buttonLabel="Or Just Say Hello"
        />
      </main>

      <SiteFooter
        vol="Vol. 05 // Website Optimisation"
        tagline={<>Design. SEO. Copy. Conversion.<br />Built by the team that fills the site, not just ships it.</>}
      />

      <ScrollObserver />
    </>
  )
}
