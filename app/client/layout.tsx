'use client'

import { useEffect, useState } from 'react'
import { ClerkProvider, UserButton, useUser } from '@clerk/nextjs'
import { Moon, Sun } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { nextPortalMode, PORTAL_MODE_KEY, readPortalMode, type PortalMode } from '../lib/portal-theme'

/**
 * The client's own theme, on the logged-in portal.
 *
 * The share-link portal has had a toggle since it shipped; this side had none
 * and was painted in hard-coded `zinc-50` / `white`, so a client who chose
 * light or dark on the link they were emailed lost that choice the moment they
 * signed in. Same storage key as PortalShell, so it IS one choice rather than
 * two that disagree — and `.dark` is toggled the way the dashboard does it, so
 * the shadcn cards inside follow along instead of staying in daylight.
 */
function usePortalTheme() {
  const [theme, setTheme] = useState<PortalMode>('light')
  // read after mount: touching storage during render is a hydration mismatch
  useEffect(() => { setTheme(readPortalMode(localStorage.getItem(PORTAL_MODE_KEY))) }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    return () => document.documentElement.classList.remove('dark')
  }, [theme])
  const flip = () => {
    const next = nextPortalMode(theme)
    setTheme(next)
    try { localStorage.setItem(PORTAL_MODE_KEY, next) } catch { /* private mode */ }
  }
  return { theme, flip }
}

/** Client portal shell — deliberately calm: brand mark, their name, sign-out.
 *  No internal navigation, no team noise. Wrapped in .dbx so the shadcn
 *  preflight/tokens apply here exactly as in the dashboard. */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const { theme, flip } = usePortalTheme()
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      {/* token classes, not zinc literals: the hard-coded pair could not go
          dark however the theme was set */}
      <div className="dbx min-h-screen bg-background text-foreground antialiased">
        <Header theme={theme} onFlip={flip} />
        {/* portal-legible: the same sub-12px type floor the share-link portal
            gets below the desktop breakpoint — this page renders the same
            PortalBoard / PortalSections components. See app/globals.css.
            Wide, because the board is five columns. */}
        <main className="portal-legible mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="portal-legible mx-auto max-w-4xl px-4 pb-8 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 dark:text-zinc-500">
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster />
      </div>
    </ClerkProvider>
  )
}

function Header({ theme, onFlip }: { theme: PortalMode; onFlip: () => void }) {
  const { user } = useUser()
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">Client portal</p>
        <div className="ml-auto flex items-center gap-3">
          {user && <span className="hidden text-xs text-zinc-500 dark:text-zinc-400 sm:block">{user.firstName ?? user.emailAddresses[0]?.emailAddress}</span>}
          {/* in the header strip, like the share-link portal below sm: the one
              band of the page with no controls of its own to sit on top of */}
          <button
            type="button"
            onClick={onFlip}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          {/* see dashboard/layout.tsx — "/" on this host is the marketing site */}
          <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28, borderRadius: 8 } } }} />
        </div>
      </div>
    </header>
  )
}
