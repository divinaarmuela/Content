'use client'

import { useEffect, useRef } from 'react'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/0123456789'
const rand = (arr: string) => arr[Math.floor(Math.random() * arr.length)]

// Glitch-typewriter matching ServicesNav / ThingsWeDo (blue / dark cursor on the
// light CTA background). Types `finalText` (newlines → <br>) char by char, then
// restores `finalHtml` so the blue "sells." accent survives.
function typewriterText(el: HTMLElement, finalText: string, finalHtml: string, speed = 45) {
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
      el.innerHTML = finalHtml
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

const FINAL_TEXT = 'Stop guessing.\nStart building\na brand that sells.'
const FINAL_HTML = 'Stop guessing.<br>Start building<br>a brand that <span class="blue">sells.</span>'

export default function CtaHeading() {
  const ref = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let fired = false
    const io = new IntersectionObserver(
      (entries) => {
        if (fired || !entries[0].isIntersecting) return
        fired = true
        el.style.visibility = 'visible'
        typewriterText(el, FINAL_TEXT, FINAL_HTML)
        io.disconnect()
      },
      { threshold: 0.6 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <h2 ref={ref} className="cta-heading" style={{ visibility: 'hidden' }}>
      Stop guessing.<br />
      Start building<br />
      a brand that <span className="blue">sells.</span>
    </h2>
  )
}
