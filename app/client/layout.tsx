'use client'

import { ClerkProvider, UserButton, useUser } from '@clerk/nextjs'
import { Toaster } from '@/components/ui/sonner'

/** Client portal shell — deliberately calm: brand mark, their name, sign-out.
 *  No internal navigation, no team noise. Wrapped in .dbx so the shadcn
 *  preflight/tokens apply here exactly as in the dashboard. */
export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <div className="dbx min-h-screen bg-zinc-50 text-zinc-900 antialiased">
        <Header />
        <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-4xl px-4 pb-8 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400">
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster />
      </div>
    </ClerkProvider>
  )
}

function Header() {
  const { user } = useUser()
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-3 px-4 sm:px-6">
        <div className="flex items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-400">Client portal</p>
        <div className="ml-auto flex items-center gap-3">
          {user && <span className="hidden text-xs text-zinc-500 sm:block">{user.firstName ?? user.emailAddresses[0]?.emailAddress}</span>}
          <UserButton appearance={{ elements: { avatarBox: { width: 28, height: 28, borderRadius: 8 } } }} />
        </div>
      </div>
    </header>
  )
}
