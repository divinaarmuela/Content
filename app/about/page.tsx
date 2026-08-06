import { Space_Mono } from 'next/font/google'
import LamaNav from '../components/lama/LamaNav'
import LamaFooter from '../components/lama/LamaFooter'
import { archivo, sometype } from '../components/lama/fonts'
import AboutTeam from './AboutTeam'
import AboutReveal from './AboutReveal'
import styles from './about.module.css'

const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-space-mono', display: 'swap' })

const ACCENT = '#FFFFFF'
const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const EMAIL = 'mailto:hello@mdmmarketing.com.au'
const HERO_IMG = '/MDmediateam.jpg'

const beliefs = [
  { title: 'Visibility comes first', body: 'The best business in the room still loses to the one people have heard of.' },
  { title: 'It has to sound like you', body: 'Content that doesn’t feel authentic doesn’t build trust.' },
  { title: 'One partner beats five freelancers', body: 'Joined-up marketing compounds; scattered marketing leaks.' },
  { title: 'Grow at the right pace', body: 'We earn the next step, we don’t upsell you into it.' },
]

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

export default function AboutPage() {
  return (
    <div className={`${spaceMono.variable} ${archivo.variable} ${sometype.variable}`} style={{ background: '#0B0B0B', color: '#ffffff', fontFamily: SANS, fontWeight: 400, WebkitFontSmoothing: 'antialiased', overflowX: 'hidden', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.05, backgroundImage: NOISE }} />

      <LamaNav gate={false} />

      {/* HERO */}
      <header style={{ position: 'relative', minHeight: '78vh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '140px clamp(20px, 4vw, 52px) clamp(48px, 7vh, 90px)', overflow: 'hidden' }}>
        <div className={styles.drift} style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.4 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={HERO_IMG} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(11,11,11,0.6) 0%, rgba(11,11,11,0.5) 50%, #0B0B0B 100%)' }} />
        <div style={{ position: 'relative', zIndex: 3, width: '100%' }}>
          <p className={styles.reveal} style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', margin: '0 0 28px' }}>about / the studio</p>
          <h1 style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(2.2rem, 6vw, 5rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 30px', maxWidth: 1000 }}>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>We make good businesses</span></span>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>impossible to ignore.</span></span>
          </h1>
          <p className={styles.reveal} style={{ maxWidth: 620, fontSize: 'clamp(1.05rem, 1.5vw, 1.25rem)', lineHeight: 1.55, color: 'rgba(255,255,255,0.7)', margin: 0 }}>MD Media is an Australian content-led marketing studio for founders and local businesses who are great at what they do, and ready for the world to know it.</p>
        </div>
      </header>

      {/* OUR STORY */}
      <section style={{ padding: 'clamp(80px, 13vh, 170px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
        <div className={styles.storyGrid}>
          <div>
            <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT, margin: '0 0 22px' }}>why we exist</p>
            <div className={styles.reveal} style={{ height: 1, background: 'rgba(255,255,255,0.25)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <h2 style={{ fontFamily: SANS, fontWeight: 400, fontSize: 'clamp(1.5rem, 3vw, 2.4rem)', lineHeight: 1.2, letterSpacing: '-0.025em', margin: 0 }}>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.08em' }}>Most agencies are built by marketers.</span></span>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.08em' }}>We{'’'}re built by people who{'’'}ve lived on</span></span>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.08em' }}>both sides of the camera.</span></span>
            </h2>
            <p className={styles.reveal} style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', margin: 0 }}>Divina spent years understanding what makes people follow, trust, and buy. Not from a textbook, but from living in the world of influence and watching human behaviour up close. Martin built his eye through media and production, learning what makes someone stop, stay, and feel something.</p>
            <p className={styles.reveal} style={{ fontFamily: SANS, fontSize: 'clamp(1.25rem, 2vw, 1.7rem)', lineHeight: 1.35, letterSpacing: '-0.02em', color: '#ffffff', margin: 0 }}>When they came together in late 2024, MD Media was the only logical outcome. A studio that doesn{'’'}t just produce content, it understands the psychology behind why content works.</p>
            <p className={styles.reveal} style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', margin: 0 }}>Today MD Media runs content ecosystems with a team of 13, for businesses across finance, hospitality, real estate, health, automotive, and personal brands. Alongside always-on content, the studio takes on campaign shoots for brands, owning the vision from ideation through to execution. From strategy to the final frame, everything stays in-house.</p>
          </div>
        </div>
      </section>

      {/* WHAT WE BELIEVE */}
      <section style={{ padding: 'clamp(70px, 11vh, 150px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.12)', background: '#0E0E0E' }}>
        <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: '0 0 clamp(40px, 6vh, 64px)' }}>what we believe</p>

        <div className={styles.reveal} style={{ height: 1, background: 'rgba(255,255,255,0.22)' }} />
        {beliefs.map((belief, i) => (
          <div key={belief.title}>
            <div className={`${styles.beliefRow} ${styles.reveal}`}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: ACCENT }}>{String(i + 1).padStart(2, '0')}</span>
              <h3 style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(1.25rem, 2vw, 1.7rem)', letterSpacing: '-0.02em', margin: 0 }}>{belief.title}</h3>
              <p style={{ fontSize: 'clamp(1rem, 1.2vw, 1.12rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.6)', margin: 0 }}>{belief.body}</p>
            </div>
            <div className={styles.reveal} style={{ height: 1, background: 'rgba(255,255,255,0.22)' }} />
          </div>
        ))}
      </section>

      {/* THE TEAM */}
      <section style={{ padding: 'clamp(80px, 13vh, 170px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
        <div className={styles.teamHead}>
          <div>
            <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: '0 0 24px' }}>the team</p>
            <h2 style={{ fontFamily: SANS, fontWeight: 400, fontSize: 'clamp(1.9rem, 4vw, 3.2rem)', lineHeight: 1.06, letterSpacing: '-0.03em', margin: 0 }}>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>The people behind</span></span>
              <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>your visibility.</span></span>
            </h2>
          </div>
          <p className={styles.reveal} style={{ fontSize: 'clamp(1rem, 1.25vw, 1.15rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.6)', margin: 0 }}>Account leads, social media managers, creatives, ads, tech and operations, one team under one roof, so nothing about your marketing falls between the cracks.</p>
        </div>

        <AboutTeam />
      </section>

      {/* CTA */}
      <section style={{ position: 'relative', padding: 'clamp(110px, 18vh, 220px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.12)', textAlign: 'center' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <h2 style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(2rem, 5.5vw, 4.6rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 36px' }}>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>Let{'’'}s make your business</span></span>
            <span style={{ display: 'block', overflow: 'hidden' }}><span className={styles.reveal} style={{ display: 'block', paddingBottom: '0.1em' }}>the one people have heard of.</span></span>
          </h2>
          <a href={EMAIL} style={{ textDecoration: 'none', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 14, letterSpacing: '0.04em', padding: '17px 36px', borderRadius: 100, display: 'inline-flex', alignItems: 'center', gap: 10 }}>start now <span style={{ fontSize: 16 }}>→</span></a>
        </div>
      </section>

      <LamaFooter vol="About · team of 13" />
      <AboutReveal />
    </div>
  )
}
