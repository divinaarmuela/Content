'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * Owns the portal's theme. Ink-and-cream dark is the house default; the
 * toggle flips to a paper-light variant and remembers the choice per
 * browser. The hero stays cinematic-dark in both (it sits over footage);
 * everything below follows the tokens.
 */

const THEMES = {
  dark: {
    '--p-bg': '#0B0B0B',
    '--p-ink': '#f9f4eb',
    '--p-surface': '#141414',
    '--p-border': 'rgba(249,244,235,0.16)',
    '--p-accent': '#f9f4eb',
    '--p-accent-ink': '#0B0B0B',
  },
  light: {
    '--p-bg': '#f9f4eb',
    '--p-ink': '#0B0B0B',
    '--p-surface': '#ffffff',
    '--p-border': 'rgba(11,11,11,0.14)',
    '--p-accent': '#0B0B0B',
    '--p-accent-ink': '#f9f4eb',
  },
} as const

export default function PortalShell({ className = '', children }: {
  className?: string
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  useEffect(() => {
    const saved = localStorage.getItem('mdm-portal-theme')
    if (saved === 'light') setTheme('light')
  }, [])
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('mdm-portal-theme', next)
  }

  return (
    <div
      className={`${className} min-h-screen antialiased transition-colors duration-300`}
      style={{
        background: 'var(--p-bg)',
        color: 'var(--p-ink)',
        ...THEMES[theme],
      } as React.CSSProperties}
    >
      {children}
      <button
        type="button"
        onClick={flip}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="fixed bottom-4 left-4 z-40 flex h-10 w-10 items-center justify-center rounded-full backdrop-blur transition-opacity hover:opacity-100"
        style={{ background: 'var(--p-surface)', border: '1px solid var(--p-border)', color: 'var(--p-ink)', opacity: 0.85 }}
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  )
}
