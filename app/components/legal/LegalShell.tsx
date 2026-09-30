import type { ReactNode } from 'react'
import LamaNav from '../lama/LamaNav'
import LamaFooter from '../lama/LamaFooter'
import { archivo, sometype } from '../lama/fonts'
import { LEGAL_UPDATED } from '../../lib/legal-pages'

/**
 * The frame for /privacy, /terms and /data-deletion: the marketing site's
 * dark "lama" look (LamaNav, LamaFooter, ink and cream) with a readable
 * single column. Inline styles, as the other lama pages use, so nothing here
 * adds a selector to app/globals.css (CLAUDE.md trap 2).
 */

const MONO = 'var(--font-sometype), "Courier New", monospace'
const SANS = "var(--font-archivo), 'Helvetica Neue', Helvetica, Arial, sans-serif"
const DIM = 'rgba(249,244,235,0.72)'
const FAINT = 'rgba(249,244,235,0.4)'

export default function LegalShell({ eyebrow, title, intro, draft, vol, children }: {
  eyebrow: string
  title: string
  intro?: ReactNode
  draft: boolean
  vol: string
  children: ReactNode
}) {
  return (
    <div className={`${archivo.variable} ${sometype.variable}`} style={{ background: '#0B0B0B', color: '#f9f4eb', fontFamily: SANS, WebkitFontSmoothing: 'antialiased', overflowX: 'hidden', minHeight: '100vh' }}>
      <LamaNav gate={false} />

      <main style={{ padding: '140px clamp(16px, 4vw, 52px) clamp(64px, 10vh, 120px)' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {draft && (
            <div role="note" style={{ border: '1px solid #f5c542', background: 'rgba(245,197,66,0.1)', color: '#f5c542', fontFamily: MONO, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '12px 16px', borderRadius: 6, margin: '0 0 36px' }}>
              Draft — pending owner review. Not yet in force.
            </div>
          )}
          <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: FAINT, margin: '0 0 20px' }}>{eyebrow}</p>
          <h1 style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(2.2rem, 6vw, 4rem)', lineHeight: 1.02, letterSpacing: '-0.04em', margin: '0 0 22px', color: '#f9f4eb' }}>{title}</h1>
          <p style={{ fontFamily: MONO, fontSize: 12, letterSpacing: '0.06em', color: FAINT, margin: '0 0 32px' }}>Last updated {LEGAL_UPDATED}</p>
          {intro && <div style={{ fontSize: 'clamp(1.05rem, 1.4vw, 1.2rem)', lineHeight: 1.6, color: DIM, margin: '0 0 12px' }}>{intro}</div>}
          <div style={{ borderTop: '1px solid rgba(249,244,235,0.15)', marginTop: 28 }}>{children}</div>
        </div>
      </main>

      <LamaFooter vol={vol} />
    </div>
  )
}

export function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} style={{ padding: '36px 0 8px', scrollMarginTop: 100 }}>
      <h2 style={{ fontFamily: SANS, fontWeight: 500, fontSize: 'clamp(1.3rem, 2.4vw, 1.7rem)', lineHeight: 1.2, letterSpacing: '-0.02em', margin: '0 0 16px', color: '#f9f4eb' }}>{title}</h2>
      {children}
    </section>
  )
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 style={{ fontFamily: SANS, fontWeight: 500, fontSize: '1.08rem', lineHeight: 1.3, margin: '22px 0 8px', color: '#f9f4eb' }}>{children}</h3>
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: '1rem', lineHeight: 1.7, color: DIM, margin: '0 0 14px' }}>{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul style={{ fontSize: '1rem', lineHeight: 1.7, color: DIM, margin: '0 0 16px', paddingLeft: 22, listStyle: 'disc' }}>{children}</ul>
}

export function LI({ children }: { children: ReactNode }) {
  return <li style={{ margin: '0 0 8px' }}>{children}</li>
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const ext = /^https?:/.test(href)
  return (
    <a href={href} {...(ext ? { target: '_blank', rel: 'noreferrer noopener' } : {})} style={{ color: '#f9f4eb', textDecoration: 'underline', textUnderlineOffset: 3 }}>
      {children}
    </a>
  )
}

/** a business fact the owner must supply — visible, so it cannot ship unnoticed */
export function Fill({ children }: { children: ReactNode }) {
  return <mark style={{ background: 'rgba(245,197,66,0.18)', color: '#f5c542', padding: '0 4px', borderRadius: 3, fontFamily: MONO, fontSize: '0.9em' }}>{children}</mark>
}
