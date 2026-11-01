'use client'

import { useEffect, useRef, useState } from 'react'

const services = [
  {
    name: 'Strategy & Consulting',
    desc: 'We sharpen your positioning, fix your offers, and map the path from where you are to where you want to be. Then we build it, or hand you the playbook.',
    subs: ['Positioning', 'Offer & pricing', 'Roadmap', 'Advisory'],
    href: '/services/strategy',
  },
  {
    name: 'Branding Suite',
    desc: 'The full identity: how you look, how you sound, and how you’re remembered. A strong brand makes your content, ads, and prices work harder.',
    subs: ['Logo & identity', 'Messaging', 'Colour & type', 'Templates'],
    href: '/services/branding-suite',
  },
  {
    name: 'Custom Websites',
    desc: 'Fast, custom sites that look like your brand and are built to convert. Then we keep them running so they never go stale.',
    subs: ['Design & build', 'Copy', 'Mobile & speed', 'Hosting & care'],
    href: '/services/custom-websites',
  },
  {
    name: 'Content & Visibility',
    desc: 'Photo, video, and social content that makes you look established and keeps you in front of the right audience, plus full campaign shoots from concept to delivery.',
    subs: ['Content strategy', 'Campaign shoots', 'Social', 'Posting'],
    href: '/services/content-visibility',
  },
]

export default function HomeServices() {
  const [active, setActive] = useState(0)
  const step = (d: number) => setActive(a => (a + d + services.length) % services.length)
  const list = useRef<HTMLUListElement>(null)

  // Phones have no hover: the service crossing the middle of the screen lights up as you scroll.
  useEffect(() => {
    const ul = list.current
    if (!ul || !window.matchMedia('(max-width: 860px)').matches) return
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i))
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    ul.querySelectorAll('li').forEach(li => io.observe(li))
    return () => io.disconnect()
  }, [])

  return (
    <>
      <ul className="hm-svc" ref={list}>
        {services.map((s, i) => (
          <li
            key={s.name}
            data-i={i}
            className={i === active ? 'is-on' : undefined}
            onMouseEnter={() => setActive(i)}
          >
            <button type="button" className="hm-svc-name" onClick={() => setActive(i)} aria-expanded={i === active}>
              {s.name}
            </button>
            <div className="hm-svc-body">
              <p>{s.desc}</p>
              <p className="hm-mono hm-svc-subs">{s.subs.join(' · ')}</p>
            </div>
            <a className="hm-mono hm-svc-more" href={s.href} tabIndex={i === active ? 0 : -1}>( Learn more )</a>
          </li>
        ))}
      </ul>
      <div className="hm-svc-nav">
        <button type="button" aria-label="Previous service" onClick={() => step(-1)}>‹</button>
        <button type="button" aria-label="Next service" onClick={() => step(1)}>›</button>
      </div>
    </>
  )
}
