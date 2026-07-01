'use client'

import { useState } from 'react'

const services = [
  {
    num: '01',
    title: 'Content\n& Visibility',
    body: 'Photo, video, and social content built around you — so you look established, sound like yourself, and stay consistent without lifting a finger.',
    img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=70',
    href: '/content',
  },
  {
    num: '02',
    title: 'Paid\nAdvertising',
    body: 'Meta, Google, and more — campaigns that turn attention into enquiries, with the numbers to prove it.',
    img: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&q=70',
    href: '/services',
  },
  {
    num: '03',
    title: 'Branding\nSuite',
    body: 'Logo, identity, messaging, and the full visual system that makes you look like the business you\'re becoming.',
    img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=70',
    href: '/branding',
  },
  {
    num: '04',
    title: 'Strategy\n& Consulting',
    body: 'The plan behind the work — positioning, offers, and a clear path from "no one knows us" to "we can\'t keep up."',
    img: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=800&q=70',
    href: '/services',
  },
]

export default function HomeServices() {
  const [active, setActive] = useState<number | null>(null)

  return (
    <section className="hsvc">
      <div className="hsvc-header">
        <p className="hsvc-label">· WHAT WE DO ·</p>
        <h2 className="hsvc-heading">Start with content.<br />Scale into the rest.</h2>
      </div>
      <div className="hsvc-panels">
        {services.map((s, i) => (
          <a
            key={i}
            href={s.href}
            className={`hsvc-panel${active === i ? ' hsvc-panel--active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <img src={s.img} alt="" className="hsvc-panel-img" loading="lazy" />
            <div className="hsvc-panel-overlay" aria-hidden="true" />
            <div className="hsvc-panel-content">
              <span className="hsvc-panel-num">{s.num}</span>
              <p className="hsvc-panel-title">
                {s.title.split('\n').map((line, j) => (
                  <span key={j}>{line}<br /></span>
                ))}
              </p>
              <p className="hsvc-panel-body">{s.body}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  )
}
