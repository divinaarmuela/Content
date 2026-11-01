import type { Metadata } from 'next'
import { archivo, sometype } from './components/lama/fonts'
import HomeServices from './components/home-v2/HomeServices'
import MdNav from './components/md-nav/MdNav'
import MdFooter from './components/md-footer/MdFooter'
import LogoWall from './components/logo-wall/LogoWall'
import './components/home-v2/home.css'
import LazyLoop from './components/lazy-loop/LazyLoop'
import HeroSync from './components/home-v2/HeroSync'

export const metadata: Metadata = {
  title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
  description: 'MD Media helps founders and local businesses get seen, known, and booked. Content-led marketing, plus paid ads, branding, and strategy. Book a strategy call.',
  keywords: 'Melbourne marketing agency, content marketing, personal brand, local business marketing, MD Media',
  robots: 'index, follow, max-image-preview:large',
  alternates: { canonical: 'https://www.mdmmarketing.com.au/' },
  openGraph: {
    type: 'website',
    url: 'https://www.mdmmarketing.com.au/',
    title: 'MD Media | Content-Led Marketing for Founders & Local Businesses',
    description: 'Content-led marketing for founders and local businesses. Book a strategy call.',
    images: 'https://static.wixstatic.com/media/c5a69a_cbe685f642bb4d75b6f9b0759d5482e2~mv2.jpg',
    siteName: 'MD Media',
    locale: 'en_AU',
  },
}

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'
const HERO = 'https://pub-e66dd091eb38427e8eaca82bde7082ef.r2.dev/hero-spec-ad.mp4'

// Tile loops: real work from each service page (`${video}.mp4` + `${video}.jpg` poster).
const tiles = [
  ['01', 'Campaign shoots', '/videos/campaign-shoots/hero-portrait', '/campaign-shoots'],
  ['02', 'Brand identity', '/videos/home/brand', '/services/branding-suite'],
  ['03', 'Social content', '/videos/content-visibility/cecconis', '/services/content-visibility'],
  // a website reads as one on a phone — a cropped screenshot of a site sat oddly beside three clips (the owner, 1 Nov 2026)
  ['04', 'Custom websites', '/videos/websites/p4-senorita', '/services/custom-websites'],
]

const steps = [
  ['Strategy call', 'We get clear on your business, your goals, and where the gaps are. No pitch deck, no jargon, just a plan.'],
  ['We build your visibility', 'We create the content and assets that get you seen, and handle the moving parts so you can stay in your zone.'],
  ['We scale what works', 'Once you’re showing up, we add paid, brand, and strategy to turn attention into a steady flow of customers.'],
]

const team = [
  ['Divina', 'Co-Founder & MD', 'reads people for a living'],
  ['Martin', 'Co-Founder & CPO', 'knows what makes you stop'],
  ['Abby', 'Head of Operations', 'keeps the machine running'],
  ['Yusuf', 'Head of Paid Media', 'spends it like it is his'],
  ['Manal', 'Senior Account Manager', 'turns chaos into calm'],
  ['Karly', 'Social Media Strategist', 'fluent in three feeds'],
  ['Renee', 'Social Media Strategist', 'writes like she talks'],
  ['Raven', 'Scheduler & Copywriter', 'early to every trend'],
  ['Daniela', 'Brand & Graphic Designer', 'obsessed with the grid'],
  ['Akmal', 'Technology & Systems Lead', 'automates the boring parts'],
  ['Ryan', 'Video Editor & Cinematographer', 'lives in the timeline'],
  ['Sebastian', 'Photographer & Cinematographer', 'chases the right light'],
  ['Sarina', 'Photographer & Cinematographer', 'makes people forget the lens'],
]

const expect = [
  'A straight look at where you’re visible and where you’re not.',
  'The one or two moves that’ll make the biggest difference.',
  'A clear sense of how we’d work together, only if it’s a fit.',
]

export default function HomePage() {
  return (
    <div className={`hm ${archivo.variable} ${sometype.variable}`}>
      <MdNav />

      <main>
        <section className="hm-hero">
          <video className="hm-hero-bg" src={HERO} muted loop playsInline preload="auto" aria-hidden="true" />
          <div className="hm-wrap hm-hero-in">
            <div className="hm-hero-top">
              <h1>We’re<br />MD Media.</h1>
              <p className="hm-mono hm-hero-side">Get seen.<br />Get known.<br />Get booked.</p>
            </div>
            <video className="hm-hero-reel" src={HERO} autoPlay muted loop playsInline aria-label="MD Media showreel" />
            <HeroSync reel=".hm-hero-reel" bg=".hm-hero-bg" />
          </div>
        </section>

        <section className="hm-wrap hm-sec hm-problem">
          <p className="hm-mono hm-label">The problem</p>
          <div>
            <p>Great businesses go unseen every day. You’re brilliant at what you do and your clients love you, but online, you’re quiet. So the people who should buy from you don’t know you exist.</p>
            <p>MD Media is content-led marketing for founders and local businesses. We start with visibility, then scale with paid, brand, and strategy. One partner who grows with you, not five freelancers you have to manage.</p>
            <a className="hm-mono hm-link" href="/about">( Get to know us )</a>
          </div>
        </section>

        <section className="hm-wrap hm-sec">
          <h2 className="hm-statement">There are two kinds of businesses now: the ones people can’t stop talking about, and the ones nobody’s heard of yet. We build the first kind.</h2>
          <div className="hm-tiles">
            {tiles.map(([n, t, img, href]) => (
              <a key={n} href={href} className="hm-tile">
                {img.includes('/websites/')
                  ? <span className="hm-tile-phone"><span className="hm-phone"><LazyLoop src={img} label={t} /></span></span>
                  : <LazyLoop src={img} label={t} />}
                <span className="hm-mono">( {n} ) {t}</span>
              </a>
            ))}
          </div>
        </section>

        <section className="hm-wrap hm-sec" id="services">
          <div className="hm-split hm-mono hm-label">
            <span>Services, not packages</span>
            <span>We meet you where you’re at</span>
          </div>
          <HomeServices />
        </section>

        <section className="hm-wrap hm-sec">
          <p className="hm-mono hm-label">How it works</p>
          <ol className="hm-steps">
            {steps.map(([t, d], i) => (
              <li key={t}>
                <span className="hm-mono">[ Step {String(i + 1).padStart(2, '0')} ]</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="hm-wrap hm-sec">
          <p className="hm-mono hm-label">Client / @beautyblvd</p>
          <blockquote className="hm-quote">
            “Their attention to detail, thorough planning, and strategic guidance made what could have been an overwhelming process feel incredibly organised and manageable.”
          </blockquote>
          <p className="hm-mono hm-cite">
            <span>Angelique Mangion, Beauty Blvd</span>
            <span>(01) Brand redesign</span><span>(02) Launch strategy</span><span>(03) Content production</span>
          </p>
        </section>

        <section className="hm-wrap hm-sec">
          <div className="hm-team-head">
            <h2>The people<br />you’ll work with.</h2>
            <p>A hands-on team that works close and moves quick. No overhead, just people who enjoy building side by side. <a href="/about" className="hm-under">Read our story →</a></p>
          </div>
          <ul className="hm-team">
            {team.map(([n, r, l]) => (
              <li key={n}>
                <span className="hm-team-n">{n}</span>
                <span><span className="hm-mono">{r}</span><span className="hm-team-l">{l}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <LogoWall className="hm-wrap hm-sec" />

        <section className="hm-wrap hm-sec hm-contact" id="contact">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/martindivina.avif" alt="Martin and Divina, MD Media's co-founders" loading="lazy" />
          <div>
            <p className="hm-mono hm-label">[ Get in touch ]</p>
            <h2>Ready to stop being<br />the best-kept secret?</h2>
            <ol className="hm-expect">
              {expect.map((e, i) => <li key={i}><span className="hm-mono">{String(i + 1).padStart(2, '0')}</span>{e}</li>)}
            </ol>
            <div className="hm-cta">
              <a className="hm-btn hm-mono" href={CALENDLY} target="_blank" rel="noreferrer noopener">Book a free strategy call ↗</a>
              <span>No obligation, no hard sell.</span>
            </div>
          </div>
        </section>
      </main>

      <MdFooter />
    </div>
  )
}
