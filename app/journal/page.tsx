import ScrollObserver from '../components/ScrollObserver'
import GradientHero from '../components/GradientHero'
import SiteFooter from '../components/SiteFooter'
import ScrambleEyebrow from '../components/ScrambleEyebrow'
import { articles } from './journalData'

export default function JournalPage() {
  const featured = articles.find(a => a.featured) ?? articles[0]
  const rest = articles.filter(a => a.slug !== featured.slug)

  return (
    <>
      <main className="ed-main">
        <GradientHero
          asciiHands
          showMarquee={false}
          tag="· The Journal ·"
          headline={{
            base: <>Straight<span className="hl-hide"> talk on<br />getting</span> known.</>,
            mid: <><span className="hl-hide">Straight </span>talk on<br />getting<span className="hl-hide"> known.</span></>,
            blob: <>Straight talk on<br />getting known.</>,
          }}
          desc={
            <>
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
                  Marketing, content, and brand — written for
                </span>
              </span>{' '}
              <span className="reveal-mask">
                <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
                  Australian business owners, not other marketers.
                </span>
              </span>
            </>
          }
          actions={<></>}
        />

        <section className="ed-section">
          <div className="container">
            <ScrambleEyebrow text="· Featured ·" />
            <a className="jrnl-feature fade-up" href={`/journal/${featured.slug}`}>
              <span className="jrnl-feature-tag">Start here</span>
              <p className="jrnl-feature-title">{featured.title}</p>
              <p className="jrnl-feature-desc">{featured.standfirst}</p>
              <p className="jrnl-feature-meta">{featured.date} · {featured.readMins} min read</p>
            </a>
          </div>
        </section>

        <section className="ed-section ed-section--line">
          <div className="container">
            <ScrambleEyebrow text="· All articles ·" />
            <h2 className="ed-heading">The rest of the shelf.</h2>
            <div className="ed-rows fade-up">
              {rest.map((a, i) => (
                <a key={a.slug} className="ed-row" href={`/journal/${a.slug}`}>
                  <span className="ed-row-idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="ed-row-name">
                    {a.title.split(':')[0]}
                    <span className="ed-row-sub">{a.date} · {a.readMins} min</span>
                  </span>
                  <span className="ed-row-desc">{a.standfirst}</span>
                  <span className="ed-row-arw">↗</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter vol="The Journal" tagline={<>Get seen. Get known.<br />Get booked.</>} />
      <ScrollObserver />
    </>
  )
}
