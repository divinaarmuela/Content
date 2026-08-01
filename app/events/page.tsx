import ScrollObserver from '../components/ScrollObserver'
import GradientHero from '../components/GradientHero'
import SiteFooter from '../components/SiteFooter'
import ScrambleEyebrow from '../components/ScrambleEyebrow'

const expect = [
  {
    num: '01',
    title: 'Small on purpose',
    body: 'Capped rooms. Everyone meets everyone. You leave with conversations, not a lanyard.',
  },
  {
    num: '02',
    title: 'Operators only',
    body: 'Owners and the people running the numbers. No audience members — everyone in the room has skin in the game.',
  },
  {
    num: '03',
    title: 'No pitching',
    body: 'Nobody presents a deck at you, including us. The format is real problems, discussed honestly.',
  },
  {
    num: '04',
    title: 'Fed and filmed',
    body: 'Good food, and the useful moments captured — attendees get the content, because of course they do.',
  },
]

// upcoming events are placeholders until dates, venues, and capacity are locked
const upcoming = [
  { idx: '01', name: 'The Room · Melbourne', sub: 'Date to be announced', desc: 'Hospitality edition — for venue owners and operators.' },
  { idx: '02', name: 'The Room · Melbourne', sub: 'Date to be announced', desc: 'Personal brand edition — for founders building in public.' },
]

export default function EventsPage() {
  return (
    <>
      <main className="ed-main">
        <GradientHero
          asciiHands
          showMarquee={false}
          tag="· The Room · Invite-first"
          headline={{
            base: <>The room<span className="hl-hide"> where<br />it</span> happens.</>,
            mid: <><span className="hl-hide">The room </span>where<br />it<span className="hl-hide"> happens.</span></>,
            blob: <>The room where<br />it happens.</>,
          }}
          desc={
            <>
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
                  Small, invite-first evenings for Melbourne business
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
                  owners. Real conversations, no pitches, no panels.
                </span>
              </span>
            </>
          }
          actions={
            <a
              href="mailto:hello@mdmmarketing.com.au?subject=The%20Room%20%E2%80%94%20invite%20request"
              className="hero-glow-btn hero-glow-btn-sharp hero-glow-btn-pulse"
            >
              Request an invite
              <span className="btn-pulse-dot" aria-hidden="true"></span>
            </a>
          }
        />

        {/* WHY WE HOST */}
        <section className="ed-section">
          <div className="container">
            <ScrambleEyebrow text="· Why we host ·" />
            <h2 className="ed-heading">The best marketing channel is still a room.</h2>
            <p className="evt-manifesto">
              Feeds are rented. Algorithms change. But the people you&apos;ve actually sat across a table from
              <span className="blue"> remember you</span> — and being remembered is the whole game.
            </p>
          </div>
        </section>

        {/* WHAT TO EXPECT */}
        <section className="ed-section ed-section--line">
          <div className="container">
            <ScrambleEyebrow text="· What to expect ·" />
            <h2 className="ed-heading">How a Room runs.</h2>
            <div className="evt-expect">
              {expect.map((e, i) => (
                <div key={e.num} className={`abt-belief fade-up${i > 0 ? ` d${Math.min(i, 3)}` : ''}`}>
                  <span className="abt-belief-num">{e.num}</span>
                  <h3>{e.title}</h3>
                  <p>{e.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* UPCOMING */}
        <section className="ed-section ed-section--line">
          <div className="container">
            <ScrambleEyebrow text="· Upcoming ·" />
            <h2 className="ed-heading">Next rooms.</h2>
            <div className="ed-rows fade-up">
              {upcoming.map(u => (
                <div key={u.idx + u.desc} className="ed-row">
                  <span className="ed-row-idx">{u.idx}</span>
                  <span className="ed-row-name">
                    {u.name}
                    <span className="ed-row-sub">{u.sub}</span>
                  </span>
                  <span className="ed-row-desc">{u.desc}</span>
                  <span className="ed-row-arw">·</span>
                </div>
              ))}
            </div>
            <p className="evt-note">Dates, venues &amp; capacity announced to the invite list first</p>
          </div>
        </section>

        {/* CTA */}
        <section className="cta-section" id="contact">
          <div className="container">
            <div className="cta-split">
              <div className="cta-left">
                <p className="cta-ready">Want in?</p>
                <h2 className="cta-heading">
                  Ask for a seat<br />
                  at the <span className="blue">table.</span>
                </h2>
                <p className="cta-sub">
                  Tell us who you are and what you run. Rooms are small, so we match the mix on purpose.
                </p>
                <div className="cta-btns">
                  <a
                    href="mailto:hello@mdmmarketing.com.au?subject=The%20Room%20%E2%80%94%20invite%20request"
                    className="btn"
                  >
                    Request an invite <span className="arr">→</span>
                  </a>
                  <a href="/about" className="btn btn-outline">
                    Who&apos;s hosting <span className="arr">→</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter vol="The Room" tagline={<>The best marketing channel<br />is still a room.</>} />
      <ScrollObserver />
    </>
  )
}
