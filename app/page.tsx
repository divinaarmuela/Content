import type { Metadata } from 'next'
import ScrollObserver from './components/ScrollObserver'
import ContactForm from './components/ContactForm'
import GradientHero from './components/GradientHero'
import ServicesNav from './components/ServicesNav'
import SilkTransition from './components/SilkTransition'
import HorizontalVideoScroll from './components/HorizontalVideoScroll'
import AboutSection from './components/AboutSection'
import ThingsWeDo from './components/ThingsWeDo'
import CtaHeading from './components/CtaHeading'
import FooterLogo from './components/FooterLogo'

export const metadata: Metadata = {
  title: 'MD Media Marketing — Melbourne Growth Agency',
  description:
    "Melbourne's end-to-end growth agency. Brand strategy, content production, and ongoing marketing built as one system for businesses that want to be impossible to ignore.",
  keywords:
    'Melbourne marketing agency, brand strategy Melbourne, content production agency, growth agency Australia, MD Media Marketing',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/',
    title: 'MD Media Marketing — Melbourne Growth Agency',
    description: "Brand strategy, content production, and ongoing marketing. Melbourne's end-to-end growth agency.",
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media Marketing',
    locale: 'en_AU',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MD Media Marketing — Melbourne Growth Agency',
    description: "Brand strategy, content production, and ongoing marketing. Melbourne's end-to-end growth agency.",
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
  },
}

/* ─── data ─────────────────────────────────────────────────── */

const serviceRoutes = [
  {
    need: 'I need a brand that stands out',
    desc: 'Brand strategy, visual identity, positioning, and messaging that makes people remember you. Whether you\'re starting fresh or levelling up.',
    cta: 'Branding & Strategy',
    href: 'https://brand.mdmmarketing.com.au/',
  },
  {
    need: 'I need consistent marketing',
    desc: 'Ongoing content, social media management, and marketing support that keeps your brand visible without you doing everything yourself.',
    cta: 'Ongoing Marketing',
    href: 'https://marketing.mdmmarketing.com.au/',
  },
  {
    need: 'I need content that converts',
    desc: 'Photography, video, copywriting, and creative assets built around your brand and designed to drive action across every platform.',
    cta: 'Content Subscription',
    href: '/content',
  },
  {
    need: "My website isn't performing",
    desc: 'Website design, SEO, conversion optimisation, and copy that turns visitors into customers.',
    cta: 'Website Optimisation',
    href: 'https://www.mdmmarketing.com.au/blank-2-1',
  },
  {
    need: 'I need a studio',
    desc: 'Professional podcast and photography studio in Melbourne. Fully equipped, ready to book.',
    cta: 'Studio Hire',
    href: 'https://www.mdmmarketing.com.au/podcast-studio',
  },
  {
    need: "I'm not sure yet",
    desc: "Book a free call and we'll figure out what makes sense for your business. No pressure, no pitch. Just a conversation.",
    cta: 'Book a Free Call',
    href: 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone',
  },
]

const pricingTiers = [
  {
    name: 'Starter',
    tag: null,
    desc: 'For businesses building their first real content presence. Consistent, strategic, and on-brand from day one.',
    features: ['Brand strategy session', '4 reels + 4 graphics / month', '1–2 platform management', 'Monthly strategy check-in', 'Content calendar'],
  },
  {
    name: 'Growth',
    tag: 'Most Popular',
    desc: 'For businesses ready to build consistent presence across platforms with ads that actually convert.',
    features: ['8 reels + 8 graphics / month', 'Half-day content shoot', '2–3 platform management', 'Basic Meta ads (1 campaign)', 'Monthly strategy call', 'Performance reporting'],
  },
  {
    name: 'Scale',
    tag: null,
    desc: 'Full-stack content and performance. For brands that want to dominate their space and generate leads at scale.',
    features: ['12–16 reels / month', 'Full-day production shoot', 'All platform management', 'Meta ads (3 campaigns)', 'Weekly reporting', 'EDM / email marketing'],
  },
  {
    name: 'Premium',
    tag: null,
    desc: 'High-volume, multi-brand ecosystem. YouTube, podcast, full-funnel everything.',
    features: ['14–20+ reels / month', 'YouTube production', 'Full ads management', 'EDM + blog / SEO', 'Dedicated account manager', 'Weekly strategy sessions'],
  },
]

const caseStudies = [
  {
    industry: 'Finance / Mortgage Broking',
    client: 'Cutter & Co',
    metric: '2 → 12',
    desc: 'From 2 leads per week to 12 inbound leads per month. In 4 months. Full ecosystem build — personal brand, company brand, product brand. 5-niche funnel with Meta ads, YouTube, and email sequences.',
  },
  {
    industry: 'Fashion & Services',
    client: 'Senorita Debutante',
    metric: '0 → 30',
    desc: 'Bookings a day. Went from zero online presence to a fully booked events calendar. Content strategy, shoot production, and consistent posting did the selling.',
  },
  {
    industry: 'Debt Firm',
    client: 'MGMT Aus',
    metric: '$15K → $5K',
    desc: "Ad spend. 1–2 leads a week → 6 leads a day. Didn't need more budget. They needed a better system.",
  },
  {
    industry: 'Automotive',
    client: 'Automodellista',
    metric: '19× ROAS',
    desc: "Return on ad spend. Content-first strategy feeding paid campaigns proved the organic content before scaling it.",
  },
]

const faqs = [
  {
    q: '"We\'ve been burned by agencies before."',
    a: "Most agencies hand you a content calendar and disappear. We run a pod model where your dedicated team owns strategy, production, and results. You'll hear from us before you have to chase us.",
  },
  {
    q: '"Can\'t we just hire someone in-house?"',
    a: "You could. One person doing strategy, filming, editing, copywriting, scheduling, ads, and reporting. Or you could get an entire team that already works together for less than a single full-time hire.",
  },
  {
    q: '"We don\'t have the budget for this."',
    a: "If your content isn't generating leads, the budget you're spending now is the waste. Our Starter tier is designed for businesses ready to do it properly but who need to be smart about investment.",
  },
  {
    q: '"We need to see results fast."',
    a: "So do we. That's why we start with a diagnostic and strategy phase before we shoot anything. Month one is the foundation. By month two, content is live. By month three, you have data to scale on.",
  },
  {
    q: '"We\'re in a niche industry, will you get it?"',
    a: "We work across finance, property, food, health, automotive, and construction. The strategy translates because we learn your industry deeply before producing a single piece.",
  },
  {
    q: '"What if we already have a brand identity?"',
    a: "Great, we work with it. Our Brand Diagnosis phase isn't about starting over. It's about finding what's working, what's not, and building a content engine that reflects the brand you've built.",
  },
]

/* ─── SVG arrow used in Wix section headers ─────────────────── */
function SectionArrow({ color = '#000000' }: { color?: string }) {
  return (
    <svg viewBox="0 0 18 24" height="24" width="18" fill="none" className="section-arrow" aria-hidden="true">
      <path strokeWidth="2" stroke={color} d="M1.276 1.414H9.51V21.79m0 0 7.646-7.55M9.51 21.79l-8.234-7.55" />
    </svg>
  )
}

/* ─── page ──────────────────────────────────────────────────── */

export default function HomePage() {
  return (
    <>
      <main>

        {/* ── HERO — gradient glow (client-logo marquee lives in its bottom) ── */}
        <GradientHero />

        {/* ── SERVICES NAV ── */}
        <ServicesNav />

        {/* ── SILK TRANSITION — scroll-jacked bridge to dark section ── */}
        <SilkTransition />

        {/* ── HORIZONTAL VIDEO SCROLL — revealed by the strip transition ── */}
        <HorizontalVideoScroll />

        {/* ── THINGS WE DO — typewriter titles + blue accents (client) ── */}
        <ThingsWeDo />

        {/* ── ABOUT — black, two-column with staggered image reveal ── */}
        <AboutSection />

        {/* ── FINAL CTA ─────────────────────────────────────────── */}
        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Ready?</p>
                <CtaHeading />
                <p className="cta-sub">
                  Take the 2-minute diagnostic and find out exactly what&apos;s holding your brand back. No pitch. No pressure. Just clarity.
                </p>
                <div className="cta-btns">
                  <a href="https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone" className="btn" target="_blank" rel="noreferrer noopener">
                    Or Just Say Hello <span className="arr">→</span>
                  </a>
                </div>
              </div>
              <div className="cta-right">
                <ContactForm />
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── FOOTER ────────────────────────────────────────────── */}
      <footer>
        <div className="container">
          <div className="footer-top">
            <div>
              <FooterLogo />
              <div className="footer-tagline">
                Strategy. Content. Clarity.<br />
                Built different. Built on intent.
              </div>
            </div>
            <div className="footer-col">
              <h4>&raquo; Services</h4>
              <p>Content Production</p>
              <p>Personal Brand</p>
              <p>Brand &amp; Strategy</p>
              <p>Ongoing Marketing</p>
              <p>Free Diagnostic</p>
            </div>
            <div className="footer-col">
              <h4>&raquo; Industries</h4>
              <p>Finance &amp; Mortgage</p>
              <p>Real Estate</p>
              <p>Food &amp; Hospitality</p>
              <p>Health &amp; Wellness</p>
              <p>Construction &amp; Trade</p>
              <p>Ecommerce</p>
              <p>Automotive</p>
            </div>
            <div className="footer-col">
              <h4>&raquo; Connect</h4>
              <a href="https://www.instagram.com/mdmedia._" target="_blank" rel="noreferrer noopener">Instagram</a>
              <a href="https://www.linkedin.com/company/mdmedia-marketing/" target="_blank" rel="noreferrer noopener">LinkedIn</a>
              <a href="https://www.tiktok.com/@mdmedia._" target="_blank" rel="noreferrer noopener">TikTok</a>
              <a href="https://youtube.com/@mdmediapodcast" target="_blank" rel="noreferrer noopener">YouTube</a>
              <a href="mailto:hello@mdmmarketing.com.au">hello@mdmmarketing.com.au</a>
              <a href="tel:+61447764477">0447 764 477</a>
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
