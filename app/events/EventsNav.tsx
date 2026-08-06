'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import styles from './events.module.css'

const MONO = 'var(--font-space-mono), monospace'
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const EMAIL = 'mailto:hello@mdmmarketing.com.au'

const MENU_LINKS = [
  { href: '/work', label: 'Work' },
  { href: '/#services', label: 'What we do' },
  { href: '/about', label: 'About us' },
  { href: '/journal', label: 'Journal' },
  { href: '/events', label: 'Events' },
  { href: EMAIL, label: 'Contact' },
]

export default function EventsNav() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <nav style={{ position: 'fixed', top: 14, left: 0, right: 0, zIndex: 160, display: 'flex', justifyContent: 'center', pointerEvents: 'none', padding: '0 14px' }}>
        <div style={{ pointerEvents: 'auto', boxSizing: 'border-box', width: 'min(92vw, clamp(340px, 31vw, 560px))', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14, padding: '13px 16px', background: 'rgba(11,11,11,0.82)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12 }}>
          <Link href="/" style={{ justifySelf: 'start', textDecoration: 'none', color: '#ffffff', fontFamily: SANS, fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>MD&nbsp;MEDIA</Link>
          <span style={{ justifySelf: 'center', fontFamily: MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', whiteSpace: 'nowrap' }}>content-led</span>
          <button onClick={() => setOpen(o => !o)} aria-label="Menu" style={{ all: 'unset', cursor: 'pointer', justifySelf: 'end', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, width: 22, height: 22 }}>
            <span style={{ display: 'block', height: 1.5, width: '100%', background: '#ffffff', transition: 'transform 0.45s cubic-bezier(0.16,1,0.3,1)', transform: open ? 'translateY(3.75px)' : 'none' }} />
            <span style={{ display: 'block', height: 1.5, width: '100%', background: '#ffffff', transition: 'opacity 0.3s ease', opacity: open ? 0 : 1 }} />
          </button>
        </div>
      </nav>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 170, background: 'rgba(11,11,11,0.72)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '14px 14px 28px', overflowY: 'auto' }}>
        <div className={styles.panel} onClick={e => e.stopPropagation()} style={{ width: 'min(92vw, clamp(340px, 31vw, 560px))', background: '#0B0B0B', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 40px 110px rgba(0,0,0,0.7)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '13px clamp(15px, 1.8vw, 19px)', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
              <span style={{ fontFamily: SANS, fontWeight: 700, fontSize: 13, letterSpacing: '-0.01em' }}>MD&nbsp;MEDIA</span>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)', whiteSpace: 'nowrap' }}>get seen · get known · get booked</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu" style={{ all: 'unset', cursor: 'pointer', width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ display: 'block', height: 1.5, width: 18, background: '#ffffff' }} />
              </button>
            </div>

            {MENU_LINKS.map((link, i) => (
              <Link key={link.label} href={link.href} className={styles.menuRow} onClick={() => setOpen(false)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px clamp(15px, 1.8vw, 19px)', borderBottom: '1px solid rgba(255,255,255,0.12)', textDecoration: 'none', color: '#ffffff', animationDelay: `${0.06 * (i + 1)}s` }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <span className={styles.menuIdx} style={{ fontFamily: MONO, fontSize: 10, color: '#FFFFFF' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(0.95rem, 1.4vw, 1.1rem)', letterSpacing: '-0.02em' }}>{link.label}</span>
                </span>
                <span className={styles.menuArrow} style={{ fontFamily: MONO, fontSize: 13 }}>↗</span>
              </Link>
            ))}

            <div className={styles.menuRow} style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 9, animationDelay: '0.42s' }}>
              <a href="#join" className={styles.menuBtn} onClick={() => setOpen(false)} style={{ textDecoration: 'none', textAlign: 'center', color: '#ffffff', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: 14, border: '1px solid rgba(255,255,255,0.28)', borderRadius: 8 }}>request an invite</a>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
                <a href={EMAIL} className={styles.menuFill} style={{ textDecoration: 'none', textAlign: 'center', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '14px 10px', borderRadius: 8 }}>book a call</a>
                <Link href="/work" className={styles.menuFill} style={{ textDecoration: 'none', textAlign: 'center', background: '#ffffff', color: '#0B0B0B', fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '14px 10px', borderRadius: 8 }}>see our work</Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
