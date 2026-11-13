import { archivo, sometype } from '../../../components/lama/fonts'
import PortalShell from '../../../components/portal/PortalShell'
import { PORTAL_TABS } from '../../../lib/one-portal-core'

/**
 * THE PORTAL WHILE IT LOADS (the owner, 13 Nov 2026: "on phone it was extremely slow … maybe we can load the page and
 * add skeleton"). The page reads the client's work before it can draw, and that took 1.3 to 2 seconds on a good day
 * and 11 on the first visit after the server had been idle. This is what shows in that wait: the portal's own header
 * and tabs, and grey shapes where the cards will be, so the client sees the portal straight away instead of a blank
 * screen. It holds nothing about the client: it is drawn before anything is read.
 */
export default function PortalLoading() {
  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div
        role="status" aria-busy="true" aria-label="Loading your portal"
        className="min-h-screen bg-background text-foreground"
        style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif' }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex flex-col gap-1 px-5 pt-3 sm:px-10">
            <div className="flex min-h-11 items-center gap-3 pr-12 sm:pr-0">
              <div className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
              </div>
              <span className="h-4 w-36 animate-pulse rounded bg-foreground/10" />
            </div>
            <div className="flex gap-2 overflow-hidden pb-3 pt-2" aria-hidden>
              {PORTAL_TABS.map(t => (
                <span key={t.key} className="inline-flex h-11 shrink-0 items-center rounded-full border border-border px-4 text-[14px] font-semibold text-muted-foreground">{t.label}</span>
              ))}
            </div>
          </div>
        </header>
        <main className="flex flex-col gap-5 px-5 py-8 sm:px-10" aria-hidden>
          <span className="h-9 w-48 animate-pulse rounded-md bg-foreground/10" />
          <p className="text-[14px] text-muted-foreground">Loading your portal…</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex flex-col gap-3 rounded-[22px] border border-border p-4">
                <span className="aspect-[4/3] w-full animate-pulse rounded-[14px] bg-foreground/10" />
                <span className="h-4 w-2/3 animate-pulse rounded bg-foreground/10" />
                <span className="h-3 w-1/2 animate-pulse rounded bg-foreground/10" />
              </div>
            ))}
          </div>
        </main>
      </div>
    </PortalShell>
  )
}
