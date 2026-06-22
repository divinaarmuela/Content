'use client'

import { useEffect, useRef } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/0123456789'
const rand = (arr: string) => arr[Math.floor(Math.random() * arr.length)]

function typewriterText(el: HTMLElement, finalText: string, speed = 45) {
  el.style.minHeight = el.offsetHeight + 'px'

  let index = 0
  let done = false

  const glitchCursor = () =>
    `<span class="tw-cursor" aria-hidden="true" style="background:${Math.random() > 0.55 ? '#298dff' : '#0c0c0c'}">${rand(CHARS)}</span>`

  const renderFull = () => {
    const html = finalText.slice(0, index).replace(/\n/g, '<br>')
    el.innerHTML = html + glitchCursor()
  }

  renderFull()

  const typingInterval = setInterval(() => {
    index++
    if (index >= finalText.length) {
      clearInterval(typingInterval)
      done = true
      el.innerHTML = finalText.replace(/\n/g, '<br>')
      el.style.minHeight = ''
    } else {
      renderFull()
    }
  }, speed)

  // glitch the cursor block independently at ~60ms between character steps
  const cursorInterval = setInterval(() => {
    if (done) { clearInterval(cursorInterval); return }
    const cursor = el.querySelector<HTMLSpanElement>('.tw-cursor')
    if (cursor) {
      cursor.textContent = rand(CHARS)
      cursor.style.background = Math.random() > 0.55 ? '#298dff' : '#0c0c0c'
    }
  }, 60)
}

const services = [
  {
    text: 'I need a brand\nthat stands out',
    desc: "Brand strategy, visual identity, positioning, and messaging that makes people remember you. Whether you're starting fresh or levelling up.",
    cta: 'Branding & Strategy',
    href: '/branding',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M14 3L17.5 10.5H25L19 15.5L21.5 23L14 18.5L6.5 23L9 15.5L3 10.5H10.5L14 3Z" stroke="white" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    text: 'I need consistent\nmarketing',
    desc: 'Ongoing content, social media management, and marketing support that keeps your brand visible without you doing everything yourself.',
    cta: 'Ongoing Marketing',
    href: '/marketing',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M4 20L10 13L15 17L22 8" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 8H16M22 8V14" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    text: 'I need content\nthat converts',
    desc: 'Photography, video, copywriting, and creative assets built around your brand and designed to drive action across every platform.',
    cta: 'Content Subscription',
    href: '/content',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="3" y="7" width="18" height="14" rx="2" stroke="white" strokeWidth="1.8" />
        <path d="M21 11.5L25 9V19L21 16.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="14" r="2" stroke="white" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    text: "My website\nisn't performing",
    desc: 'Website design, SEO, conversion optimisation, and copy that turns visitors into customers. WordPress, Shopify, Squarespace, and more.',
    cta: 'Website Optimisation',
    href: '/website',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <circle cx="14" cy="14" r="11" stroke="white" strokeWidth="1.8" />
        <path d="M3 14H25M14 3C14 3 10 8 10 14C10 20 14 25 14 25M14 3C14 3 18 8 18 14C18 20 14 25 14 25" stroke="white" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    text: 'I need a studio',
    desc: 'Professional podcast and photography studio in Melbourne. Fully equipped, ready to book. Perfect for content days, interviews, and brand shoots.',
    cta: 'Studio Hire',
    href: '/podcast-studio',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="10" y="3" width="8" height="14" rx="4" stroke="white" strokeWidth="1.8" />
        <path d="M5 15C5 20.5 9 24 14 24C19 24 23 20.5 23 15" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="14" y1="24" x2="14" y2="27" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="10" y1="27" x2="18" y2="27" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    text: "I'm not sure yet",
    desc: "That's fine. Book a free call and we'll figure out what makes sense for your business. No pressure, no pitch. Just a conversation.",
    cta: 'Book a Free Call',
    href: 'https://calendly.com/mdmmarketing-info/10-minute-content-subscription-discovery-call-m-clone',
    icon: (
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="20" height="18" rx="2" stroke="white" strokeWidth="1.8" />
        <path d="M4 11H24" stroke="white" strokeWidth="1.8" />
        <path d="M9 3V7M19 3V7" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M9 16H14M9 20H17" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
]

export default function ServicesNav() {
  const needRefs = useRef<(HTMLHeadingElement | null)[]>([])
  const triggered = useRef<boolean[]>(Array(services.length).fill(false))

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = needRefs.current.findIndex(el => el === entry.target)
          if (idx === -1 || triggered.current[idx] || !entry.isIntersecting) return
          triggered.current[idx] = true
          setTimeout(() => {
            const el = entry.target as HTMLHeadingElement
            el.style.visibility = 'visible'
            typewriterText(el, services[idx].text)
          }, idx * 100)
        })
      },
      { threshold: 0.3 }
    )
    needRefs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <section className="svc-nav" id="services">
      <div className="svc-nav-inner">
        <div className="svc-nav-header">
          <span className="svc-nav-header-tag">
            Let me direct you to the right place
            <svg className="svc-nav-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round"/>
              <polyline points="10,19 19,19 19,10" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
        <div className="svc-nav-sep" />
        {services.map((s, i) => {
          const external = s.href.startsWith('http')
          return (
            <div key={i}>
              <a
                className="svc-nav-row"
                href={s.href}
                aria-label={s.cta}
                {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
              >
                <div className="svc-nav-left">
                  <h2 ref={el => { needRefs.current[i] = el }} className="svc-nav-need">
                    {s.text}
                  </h2>
                  <p className="svc-nav-desc">{s.desc}</p>
                </div>
                <div className="svc-nav-icon">{s.icon}</div>
              </a>
              <div className="svc-nav-sep" />
            </div>
          )
        })}
      </div>
    </section>
  )
}
