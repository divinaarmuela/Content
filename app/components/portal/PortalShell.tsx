'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { nextPortalMode, PORTAL_MODE_KEY, readPortalMode, type PortalMode } from '../../lib/portal-theme'

/**
 * Owns the portal's theme. Ink-and-cream dark is the house default; the
 * toggle flips to a paper-light variant and remembers the choice per browser.
 * The hero stays cinematic-dark in both (it sits over footage); everything
 * below follows the tokens.
 *
 * The palette lives in globals.css under `[data-portal-theme]`, not in an
 * inline style object here. Inline custom properties are set on ONE element,
 * so anything further down the tree that declares `--p-bg` for its own reasons
 * — the logged-in portal does exactly that, to borrow the dashboard's tokens —
 * silently wins inside its subtree and the toggle appears to do nothing. An
 * attribute the stylesheet reads is a switch the whole page can see, and it
 * goes on <html> as well so no wrapper can shadow it.
 */
export default function PortalShell({ className = '', children }: {
  className?: string
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<PortalMode>('dark')
  useEffect(() => {
    // the saved choice can only be read after mount — reading storage during
    // render is a hydration mismatch, and the server has no browser to ask
    setTheme(readPortalMode(localStorage.getItem(PORTAL_MODE_KEY)))
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-portal-theme', theme)
    return () => document.documentElement.removeAttribute('data-portal-theme')
  }, [theme])

  const flip = () => {
    const next = nextPortalMode(theme)
    setTheme(next)
    try { localStorage.setItem(PORTAL_MODE_KEY, next) } catch { /* private mode */ }
  }

  return (
    <div
      data-portal-theme={theme}
      className={`${className} min-h-screen antialiased transition-colors duration-300`}
      style={{ background: 'var(--p-bg)', color: 'var(--p-ink)' }}
    >
      {children}
      {/* bottom-RIGHT, above everything: the portal's own action buttons are
          all left-aligned inside their cards, and a fixed pill in the bottom
          left corner sat squarely on top of the "Send" button of the
          request-changes form at ordinary window widths. The toasts moved to
          the top of the screen to make room. */}
      <button
        type="button"
        onClick={flip}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-3.5 py-2.5 text-[11px] uppercase tracking-[0.14em] shadow-lg backdrop-blur transition-transform hover:scale-105"
        style={{ background: 'var(--p-accent)', color: 'var(--p-accent-ink)', fontFamily: 'var(--p-mono-font, inherit)' }}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
    </div>
  )
}
