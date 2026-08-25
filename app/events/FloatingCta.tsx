'use client'

import { useEffect, useState } from 'react'

const MONO = 'var(--font-space-mono), monospace'

/**
 * Floating "secure your room" pill for the events page. Appears after the
 * hero scrolls away, hides again while the form itself is on screen — it
 * points at the form, so it shouldn't sit on top of it.
 */
/**
 * Land on the section heading, not the widget inside it.
 *
 * This used to point at #invite-form — the booking widget itself. While the
 * services are still loading that widget is one line of "Loading…" near the
 * bottom of the page, so the browser scrolls as far as it can and leaves you
 * in the contact section. The section exists at first paint and always will.
 *
 * 'start', not 'center': the section is taller than a phone screen, so
 * centring it puts the heading off the top and drops you mid-form.
 */
const goToBooking = () =>
  document.getElementById('join')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export default function FloatingCta() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const pastHero = window.scrollY > 40
      const form = document.getElementById('join')
      const formVisible = form
        ? form.getBoundingClientRect().top < window.innerHeight * 0.85
        : false
      setShow(pastHero && !formVisible)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      type="button"
      aria-hidden={!show}
      tabIndex={show ? 0 : -1}
      onClick={goToBooking}
      style={{
        position: 'fixed',
        right: 'clamp(16px, 3vw, 36px)',
        bottom: 'clamp(16px, 4vh, 32px)',
        zIndex: 150,
        fontFamily: MONO,
        fontSize: 12,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: '#0B0B0B',
        background: '#FFFFFF',
        border: 'none',
        borderRadius: 999,
        padding: '14px 22px',
        cursor: 'pointer',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(12px)',
        pointerEvents: show ? 'auto' : 'none',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
    >
      Secure your room ↓
    </button>
  )
}
