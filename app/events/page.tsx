import { Space_Mono } from 'next/font/google'
import LamaNav from '../components/lama/LamaNav'
import LamaFooter from '../components/lama/LamaFooter'
import LamaContact from '../components/lama/LamaContact'
import Reveal from '../components/lama/Reveal'
import Rule from '../components/lama/Rule'
import { archivo, sometype } from '../components/lama/fonts'
import styles from './events.module.css'
import { media } from '../lib/asset'
import EventBooking from './EventBooking'
import FloatingCta from './FloatingCta'

const spaceMono = Space_Mono({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-space-mono', display: 'swap' })

const ACCENT = '#FFFFFF'
const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const HERO_VIDEO = media('jason-hero.mp4')

// Future CMS seam: this array becomes a Supabase fetch in the CMS pass.
const upcoming = [
  { date: 'Date TBA', title: 'The Room, No. 01', city: 'Melbourne', seats: 'Seats capped' },
  { date: 'Date TBA', title: 'The Room, No. 02', city: 'Melbourne', seats: 'Seats capped' },
]

const manifesto = [
  'It’s for you if you’ve ever left a “networking” event feeling like everyone was selling and no one was listening.',
  'It’s for you if you’re more interested in what someone does than what they can do for you.',
  'It’s for you if you get curious about industries that aren’t yours, if you’d rather ask a good question than deliver a good pitch.',
  'It’s for the givers. The ones who connect two people who’ll never work with them, just because it makes sense. The ones who show up to learn, not to leverage.',
]

const expect = [
  { title: 'Small by design', body: 'Capped numbers so every conversation can go somewhere real. You’ll meet the room, not a crowd.' },
  { title: 'Mixed industries', body: 'Founders, marketers, creators, and builders from different worlds, chosen for curiosity, not category.' },
  { title: 'No pitching', body: 'Come to learn, give, and connect. The best business that comes from these rooms is never the point of them.' },
]

const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`

export default function EventsPage() {
  return (
    <div className={`${spaceMono.variable} ${archivo.variable} ${sometype.variable}`} style={{ background: '#0B0B0B', color: '#ffffff', fontFamily: SANS, fontWeight: 400, WebkitFontSmoothing: 'antialiased', overflowX: 'hidden', position: 'relative' }}>
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.05, backgroundImage: NOISE }} />

      <LamaNav gate={false} />

      {/* HERO */}
      <header style={{ position: 'relative', minHeight: '92vh', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '140px clamp(20px, 4vw, 52px) clamp(44px, 6vh, 72px)', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: 0.4 }}>
          <video src={HERO_VIDEO} autoPlay muted loop playsInline preload="auto" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(180deg, rgba(11,11,11,0.55) 0%, rgba(11,11,11,0.5) 45%, #0B0B0B 100%)' }} />
        <div style={{ position: 'relative', zIndex: 3, width: '100%' }}>
          <Reveal gate={false}>
            <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.65)', margin: '0 0 30px' }}>events / the room</p>
          </Reveal>
          <h1 style={{ fontWeight: 500, fontSize: 'clamp(2.6rem, 8.5vw, 7.5rem)', lineHeight: 0.92, letterSpacing: '-0.045em', margin: '0 0 28px', maxWidth: 1100 }}>
            <Reveal gate={false} delay={120} className="block"><span style={{ display: 'block', paddingBottom: '0.08em' }}>A room for the people</span></Reveal>
            <Reveal gate={false} delay={240} className="block"><span style={{ display: 'block', paddingBottom: '0.08em', color: 'rgba(255,255,255,0.55)' }}>who are loud for a living.</span></Reveal>
          </h1>
          <Reveal gate={false} delay={360}>
            <p style={{ maxWidth: 600, fontSize: 'clamp(1.05rem, 1.5vw, 1.25rem)', lineHeight: 1.55, color: 'rgba(255,255,255,0.7)', margin: 0 }}>Small, intentional gatherings for founders, marketers, and builders who{'’'}d rather ask a good question than deliver a good pitch.</p>
          </Reveal>
          <Reveal gate={false} delay={480}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 34 }}>
              <a href="#invite-form" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#0B0B0B', background: '#FFFFFF', borderRadius: 999, padding: '14px 24px', textDecoration: 'none' }}>Request an invite</a>
              <a href="#upcoming" style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#FFFFFF', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 999, padding: '13px 24px', textDecoration: 'none' }}>See upcoming rooms</a>
            </div>
          </Reveal>
        </div>
      </header>

      {/* WHY EVENTS */}
      <section style={{ padding: 'clamp(80px, 13vh, 170px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <div className={styles.whyGrid}>
          <div>
            <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: ACCENT, margin: '0 0 22px' }}>why we do this</p>
            <Rule className="bg-white/30" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <h2 style={{ fontWeight: 500, fontSize: 'clamp(1.5rem, 3vw, 2.4rem)', lineHeight: 1.18, letterSpacing: '-0.025em', margin: 0, textWrap: 'balance' }}>
              <Reveal gate={false} className="block"><span style={{ display: 'block', paddingBottom: '0.08em' }}>We build visibility for a living, so we</span></Reveal>
              <Reveal gate={false} delay={120} className="block"><span style={{ display: 'block', paddingBottom: '0.08em' }}>know how lonely the work can be.</span></Reveal>
            </h2>
            <Reveal gate={false}>
              <p style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.7)', margin: 0 }}>The people who put themselves out there every day, posting, pitching, building in public, rarely have a room that gets it. Most {'“'}networking{'”'} is transactional: everyone selling, no one listening.</p>
            </Reveal>
            <Reveal gate={false}>
              <p style={{ fontSize: 'clamp(1.05rem, 1.3vw, 1.2rem)', lineHeight: 1.6, color: 'rgba(255,255,255,0.55)', margin: 0 }}>So we started hosting the kind of gathering we always wanted to be in. No name-tag small talk, no leverage. Just genuinely interesting people, curious about each other{'’'}s work, in a space designed for real conversation. Content-led marketing is about connection, our events are simply that idea, offline.</p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* WHO THIS ROOM IS FOR */}
      <section style={{ padding: 'clamp(80px, 13vh, 180px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)', background: '#0E0E0E' }}>
        <h2 style={{ fontWeight: 500, fontSize: 'clamp(2rem, 5.5vw, 4.4rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 clamp(48px, 7vh, 80px)', maxWidth: 1000, textWrap: 'balance' }}>
          <Reveal gate={false} className="block"><span style={{ display: 'block', paddingBottom: '0.08em' }}>This room isn{'’'}t for everyone.</span></Reveal>
          <Reveal gate={false} delay={120} className="block"><span style={{ display: 'block', paddingBottom: '0.08em', color: 'rgba(255,255,255,0.5)' }}>And that{'’'}s the point.</span></Reveal>
        </h2>

        <div style={{ maxWidth: 1180 }}>
          <Rule className="bg-white/20" />
          {manifesto.map((text, i) => (
            <div key={i}>
              <Reveal gate={false}>
                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 'clamp(18px, 3vw, 44px)', alignItems: 'start', padding: 'clamp(26px, 3.4vh, 38px) 0' }}>
                  <span style={{ fontFamily: MONO, fontSize: 13, color: ACCENT }}>{String(i + 1).padStart(2, '0')}</span>
                  <p style={{ fontSize: 'clamp(1.15rem, 2vw, 1.7rem)', lineHeight: 1.35, letterSpacing: '-0.015em', margin: 0, color: 'rgba(255,255,255,0.92)', textWrap: 'balance' }}>{text}</p>
                </div>
              </Reveal>
              <Rule className="bg-white/20" />
            </div>
          ))}
        </div>

        <Reveal gate={false}>
          <p style={{ fontSize: 'clamp(1.3rem, 2.6vw, 2.2rem)', lineHeight: 1.3, letterSpacing: '-0.02em', margin: 'clamp(48px, 7vh, 80px) 0 0', maxWidth: 900, textWrap: 'balance' }}>If you{'’'}re loud for a living, content, marketing, social, building something, but you{'’'}ve never had a room that actually gets it{'…'} <span style={{ color: ACCENT }}>this is the one.</span></p>
        </Reveal>
      </section>

      {/* WHAT TO EXPECT */}
      <section style={{ padding: 'clamp(80px, 12vh, 160px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', margin: '0 0 clamp(40px, 6vh, 64px)' }}>what to expect</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'clamp(28px, 4vw, 60px)' }}>
          {expect.map((item, i) => (
            <div key={item.title}>
              <Rule className="bg-white/30" />
              <Reveal gate={false} delay={i * 120}>
                <div style={{ marginTop: 24 }}>
                  <h3 style={{ fontWeight: 500, fontSize: 'clamp(1.3rem, 2vw, 1.7rem)', letterSpacing: '-0.02em', margin: '0 0 12px' }}>{item.title}</h3>
                  <p style={{ fontSize: '1rem', lineHeight: 1.55, color: 'rgba(255,255,255,0.58)', margin: 0 }}>{item.body}</p>
                </div>
              </Reveal>
            </div>
          ))}
        </div>
      </section>

      {/* UPCOMING */}
      <section id="upcoming" style={{ padding: 'clamp(70px, 11vh, 150px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'clamp(20px, 3vh, 36px)' }}>
          <h2 style={{ fontWeight: 500, fontSize: 'clamp(1.6rem, 3.4vw, 2.6rem)', letterSpacing: '-0.03em', margin: 0 }}>Upcoming rooms</h2>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)' }}>by invitation</span>
        </div>

        <Rule className="bg-white/25" />

        {upcoming.map((room, i) => (
          <Reveal key={room.title} gate={false} delay={i * 120}>
            <a href="#join" className={styles.roomRow}>
              <span className={styles.roomDate} style={{ fontFamily: MONO, fontSize: 12, color: ACCENT }}>{room.date}</span>
              <h3 className={styles.roomTitle} style={{ fontWeight: 500, fontSize: 'clamp(1.3rem, 2.4vw, 2rem)', letterSpacing: '-0.02em', margin: 0 }}>{room.title}</h3>
              <span className={styles.roomCity} style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap' }}>{room.city}</span>
              <div className={styles.roomEnd}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>{room.seats}</span>
                <span className={styles.roomArrow} style={{ fontSize: '1.2rem' }}>↗︎</span>
              </div>
            </a>
          </Reveal>
        ))}

        <p style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: '28px 0 0' }}>Dates, venues &amp; capacity announced to the invite list first</p>
      </section>

      {/* JOIN */}
      <section id="join" style={{ scrollMarginTop: 70, position: 'relative', padding: 'clamp(100px, 16vh, 210px) clamp(20px, 4vw, 52px)', borderTop: '1px solid rgba(255,255,255,0.16)', textAlign: 'center' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <h2 style={{ fontWeight: 500, fontSize: 'clamp(2rem, 5.5vw, 4.6rem)', lineHeight: 1.0, letterSpacing: '-0.04em', margin: '0 0 28px' }}>
            <Reveal gate={false} className="block"><span style={{ display: 'block', paddingBottom: '0.08em' }}>Sound like your kind of room?</span></Reveal>
          </h2>
          <Reveal gate={false} delay={120}>
            <p style={{ maxWidth: 540, margin: '0 auto 40px', fontSize: 'clamp(1.05rem, 1.5vw, 1.22rem)', lineHeight: 1.55, color: 'rgba(255,255,255,0.6)' }}>Rooms are kept small, so seats are limited. Pick a date and book yours below.</p>
          </Reveal>
          <Reveal gate={false} delay={240}>
            <div id="invite-form">
              <EventBooking slug="the-room" />
            </div>
          </Reveal>
        </div>
      </section>

      <LamaContact gate={false} />
      <LamaFooter vol="The Room · by invitation" />
      <FloatingCta />
    </div>
  )
}
