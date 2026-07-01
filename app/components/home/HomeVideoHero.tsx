'use client'

const CALENDLY = 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone'

export default function HomeVideoHero() {
  const scrollToSolution = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault()
    const el = document.getElementById('solution')
    if (!el) return
    const lenis = (window as unknown as { __lenis?: { scrollTo: (y: number) => void } }).__lenis
    const y = el.getBoundingClientRect().top + window.scrollY
    if (lenis) lenis.scrollTo(y)
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <section className="hvh">
      <video
        className="hvh-video"
        src="https://stabondar.b-cdn.net/ciridae/hero_web.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
      <div className="hvh-overlay" aria-hidden="true" />
      <div className="filmhero-grain" aria-hidden="true" />

      <div className="hvh-content">
        <p className="hvh-tag">· MD MEDIA MARKETING ·</p>
        <h1 className="hvh-headline">
          You&rsquo;re the best-kept secret<br />
          in your market.<br />
          Let&rsquo;s fix that.
        </h1>
        <div className="hvh-actions">
          <a
            href={CALENDLY}
            target="_blank"
            rel="noreferrer noopener"
            className="hvh-btn hvh-btn--fill"
          >
            Book a strategy call
          </a>
          <a href="#solution" onClick={scrollToSolution} className="hvh-btn hvh-btn--outline">
            See how we work
          </a>
        </div>
      </div>

      <div className="hvh-scroll-hint" aria-hidden="true">
        <span />
      </div>
    </section>
  )
}
