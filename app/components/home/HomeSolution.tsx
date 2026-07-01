'use client'

import { useEffect, useRef } from 'react'

const cards = [
  {
    num: '01',
    title: 'Content First',
    body: 'We start with visibility — content built around you, your story, and your offer — so you start showing up where your customers already are.',
    icon: '✦',
  },
  {
    num: '02',
    title: 'Scale Into It',
    body: 'As it works, we scale: paid advertising to put fuel behind it, a full brand to make it look the part, and strategy to tie it all together.',
    icon: '◈',
  },
  {
    num: '03',
    title: 'One Team',
    body: "You get a marketing partner who grows with you — not five separate freelancers you have to manage.",
    icon: '⬡',
  },
]

export default function HomeSolution() {
  const bgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const bg = bgRef.current
    if (!bg) return

    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        if (!bg) return
        const rect = bg.parentElement!.getBoundingClientRect()
        const offset = -rect.top * 0.3
        bg.style.transform = `translateY(${offset}px)`
      })
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <section className="hsol" id="solution">
      <div className="hsol-bg" ref={bgRef} aria-hidden="true" />
      <div className="hsol-inner">
        <p className="hsol-label">· THE SOLUTION ·</p>
        <h2 className="hsol-heading">One team. Content first.<br />Everything you need next.</h2>
        <div className="hsol-cards">
          {cards.map((c) => (
            <div className="hsol-card" key={c.num}>
              <span className="hsol-card-num">{c.num}</span>
              <p className="hsol-card-title">{c.title}</p>
              <p className="hsol-card-body">{c.body}</p>
              <span className="hsol-card-icon" aria-hidden="true">{c.icon}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
