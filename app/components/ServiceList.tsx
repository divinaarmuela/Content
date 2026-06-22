'use client'

import { useEffect, useRef } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/0123456789'
const rand = (arr: string) => arr[Math.floor(Math.random() * arr.length)]

// Glitch-typewriter identical to the homepage ServicesNav — types the title out
// one char at a time behind a flickering blue/black cursor block.
function typewriterText(el: HTMLElement, finalText: string, speed = 45) {
  el.style.minHeight = el.offsetHeight + 'px'

  let index = 0
  let done = false

  const glitchCursor = () =>
    `<span class="tw-cursor" aria-hidden="true" style="background:${Math.random() > 0.55 ? '#298dff' : '#0c0c0c'}">${rand(CHARS)}</span>`

  const renderFull = () => {
    el.innerHTML = finalText.slice(0, index).replace(/\n/g, '<br>') + glitchCursor()
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

  const cursorInterval = setInterval(() => {
    if (done) { clearInterval(cursorInterval); return }
    const cursor = el.querySelector<HTMLSpanElement>('.tw-cursor')
    if (cursor) {
      cursor.textContent = rand(CHARS)
      cursor.style.background = Math.random() > 0.55 ? '#298dff' : '#0c0c0c'
    }
  }, 60)
}

export type ServiceListItem = { title: string; desc: string; icon: React.ReactNode }

/**
 * Homepage "ServicesNav"-style list: white block, dotted separators, big
 * glitch-typewriter row titles, descriptions, and a blue icon tile per row.
 */
export default function ServiceList({
  headerTag,
  items,
}: {
  headerTag: string
  items: ServiceListItem[]
}) {
  const titleRefs = useRef<(HTMLHeadingElement | null)[]>([])
  const triggered = useRef<boolean[]>(Array(items.length).fill(false))

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const idx = titleRefs.current.findIndex((el) => el === entry.target)
          if (idx === -1 || triggered.current[idx] || !entry.isIntersecting) return
          triggered.current[idx] = true
          setTimeout(() => {
            const el = entry.target as HTMLHeadingElement
            el.style.visibility = 'visible'
            typewriterText(el, items[idx].title)
          }, idx * 100)
        })
      },
      { threshold: 0.3 }
    )
    titleRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [items])

  return (
    <section className="svc-nav">
      <div className="svc-nav-inner">
        <div className="svc-nav-header">
          <span className="svc-nav-header-tag">
            {headerTag}
            <svg className="svc-nav-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <line x1="5" y1="5" x2="19" y2="19" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" />
              <polyline points="10,19 19,19 19,10" stroke="#0c0c0c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
        <div className="svc-nav-sep" />
        {items.map((s, i) => (
          <div key={i}>
            <div className="svc-nav-row">
              <div className="svc-nav-left">
                <h3 ref={(el) => { titleRefs.current[i] = el }} className="svc-nav-need">
                  {s.title}
                </h3>
                <p className="svc-nav-desc">{s.desc}</p>
              </div>
              <div className="svc-nav-icon">{s.icon}</div>
            </div>
            <div className="svc-nav-sep" />
          </div>
        ))}
      </div>
    </section>
  )
}
