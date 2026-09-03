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
    // …and the shadcn tokens too.
    //
    // `data-portal-theme` drives the --p-* palette, which is the portal's own
    // chrome. But every one of these pages also carries `.dbx`, and the cards,
    // dialogs, inputs and badges inside them are painted from --background /
    // --card / --border, which only move when `.dark` is on <html>. So the
    // toggle flipped the page around the content and left the content itself
    // in daylight — a half-applied theme, which reads as broken rather than as
    // a choice. One class, the same one the dashboard toggles, and the whole
    // page moves together.
    document.documentElement.classList.toggle('dark', theme === 'dark')
    return () => {
      document.documentElement.removeAttribute('data-portal-theme')
      document.documentElement.classList.remove('dark')
    }
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
      {/* bottom-RIGHT from sm up, above everything: the portal's own action
          buttons are all left-aligned inside their cards, and a fixed pill in
          the bottom left corner sat squarely on top of the "Send" button of the
          request-changes form at ordinary window widths. The toasts moved to
          the top of the screen to make room.

          On a phone there is no free corner at all — the cards are full-bleed,
          so a bottom-right pill lands on whatever control happens to be at the
          bottom of the screen (`npm run check:mobile` caught it sitting on the
          shoot plan's PDF link). Below sm it docks into the sticky header strip
          instead, icon-only: the top bar is the one band of the page with no
          controls in it, so it can never cover one. */}
      <button
        type="button"
        onClick={flip}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="portal-tap fixed right-3 top-1.5 z-50 flex min-h-11 items-center justify-center gap-2 rounded-full px-3 py-3 text-[11px] uppercase tracking-[0.14em] shadow-lg backdrop-blur transition-transform hover:scale-105 sm:bottom-4 sm:right-4 sm:top-auto sm:px-4"
        style={{ background: 'var(--p-accent)', color: 'var(--p-accent-ink)', fontFamily: 'var(--p-mono-font, inherit)' }}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        <span className="hidden sm:inline">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
      </button>
    </div>
  )
}
