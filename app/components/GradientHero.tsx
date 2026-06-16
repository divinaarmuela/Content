'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

const clientLogos = [
  'c5a69a_a57a94655c1d465581b0d60a633269da~mv2.png',
  'c5a69a_c1d2c702bc7a47c0a3670eaf449e48f8~mv2.png',
  'c5a69a_1ff2bb6a1aaa41ff85948094bae68cb6~mv2.png',
  'c5a69a_9f973b4c457441ea827b9c101d3b74e8~mv2.png',
  'c5a69a_9c826734acc646eb846219ac76393853~mv2.png',
  'c5a69a_9b50e5225f7243b5ad1c7826ac414bcc~mv2.png',
  'c5a69a_7785ca4f44ec4f09bcdb8ca0b0861852~mv2.png',
  'c5a69a_29646c60053a4060993c481b10aed67e~mv2.png',
  'c5a69a_ea64382bc50b443f86001d4febdb8746~mv2.png',
  'c5a69a_f2608dab4cc646c2864fa1f501217e59~mv2.png',
  'c5a69a_67b4f93fb988428b93425a6de9e7b2c4~mv2.png',
  'c5a69a_1664d27fee9744c48a2863b6b9e20ed7~mv2.png',
  'c5a69a_76c36272f9ef485d99928b7faed5cc1a~mv2.png',
]

export default function GradientHero() {
  const h1Ref    = useRef<HTMLHeadingElement>(null)
  const sharpRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const h1 = h1Ref.current
    const sharp = sharpRef.current
    if (!h1 || !sharp) return

    const onMove = (e: MouseEvent) => {
      const r = sharp.getBoundingClientRect()
      sharp.style.setProperty('--mx', `${e.clientX - r.left}px`)
      sharp.style.setProperty('--my', `${e.clientY - r.top}px`)
    }

    // no leave handler — the blob just fades out where it is (CSS :hover),
    // so it never snaps back to centre and flashes blue mid-phrase
    h1.addEventListener('mousemove', onMove)
    return () => {
      h1.removeEventListener('mousemove', onMove)
    }
  }, [])

  // "Get started" jumps to #contact, which sits past the scroll-jacked silk
  // transition. A plain anchor jump would scroll THROUGH the seam and fire the
  // curtain mid-flight, so we hand off to the transition (it bypasses itself and
  // snaps straight to the target), exactly like the nav links do.
  const handleGetStarted = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const el = document.querySelector('#contact') as HTMLElement | null
    if (!el) return
    e.preventDefault()
    if (document.querySelector('.silk-canvas')) {
      window.dispatchEvent(new CustomEvent('nav-goto', { detail: '#contact' }))
      return
    }
    const y = el.getBoundingClientRect().top + window.scrollY
    const lenis = (window as unknown as { __lenis?: { scrollTo: (t: number) => void } }).__lenis
    if (lenis) lenis.scrollTo(y)
    else window.scrollTo({ top: y, behavior: 'smooth' })
  }

  return (
    <section className="hero-glow">
      <motion.div
        className="hero-glow-bg"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 2.5, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden="true"
      />
      <div className="filmhero-grain" aria-hidden="true" />

      <div className="hero-glow-inner">
        <p className="hero-glow-tag">· MD Media Marketing</p>

        <div className="gh-headline-zone">
          <h1 ref={h1Ref} className="hero-glow-h1">
            {/* base: edge words "Creative" + "Converts" blurred (middle hidden) */}
            <span className="hl-layer hl-base">
              Creative<span className="hl-hide"> that Captures,<br />Strategy that </span>Converts
            </span>
            {/* middle "that Captures / Strategy that" — always sharp, blob-independent */}
            <span className="hl-layer hl-mid" aria-hidden="true">
              <span className="hl-hide">Creative </span>that Captures,<br />Strategy that<span className="hl-hide"> Converts</span>
            </span>
            {/* full phrase sharp, revealed only inside the cursor blob */}
            <span ref={sharpRef} className="hl-layer hl-blob" aria-hidden="true">
              Creative that Captures,<br />Strategy that Converts
            </span>
          </h1>
        </div>

        <p className="hero-glow-desc">
          <span className="reveal-mask">
            <span className="reveal-inner" style={{ animationDelay: '0.6s' }}>
              Melbourne&apos;s end-to-end growth agency.
            </span>
          </span>{' '}
          <span className="reveal-mask">
            <span className="reveal-inner" style={{ animationDelay: '0.68s' }}>
              Strategy, content, and performance built as
            </span>
          </span>{' '}
          <span className="reveal-mask">
            <span className="reveal-inner" style={{ animationDelay: '0.76s' }}>
              one system for businesses ready to stop blending in.
            </span>
          </span>
        </p>

        <div className="hero-glow-actions">
          <a href="#contact" onClick={handleGetStarted} className="hero-glow-btn hero-glow-btn-sharp">
            Get started
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
        </div>
      </div>

      {/* client logos marquee — transparent strip across the hero's bottom */}
      <div className="hero-glow-marquee" aria-label="Clients and partners">
        <div className="logos-track">
          {[...clientLogos, ...clientLogos].map((logo, i) => (
            <div key={i} className="logos-item">
              <img
                src={`https://static.wixstatic.com/media/${logo}/v1/fit/w_213,h_90,q_90,enc_avif,quality_auto/${logo}`}
                alt=""
                loading="lazy"
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
