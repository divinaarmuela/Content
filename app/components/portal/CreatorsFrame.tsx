import { Toaster } from 'sonner'
import { archivo, sometype } from '../lama/fonts'
import PortalShell from './PortalShell'

/**
 * The page a client's creator campaigns sit in: the same MD Media header and theme as the rest of their portal
 * (team boards, shoots), so it reads as one more part of the link they already have.
 */
export default function CreatorsFrame({ clientName, crumb, bleed = false, children }: {
  clientName: string; crumb: string
  /** the page runs edge to edge and keeps its own margins (a campaign's cover photograph) */
  bleed?: boolean
  children: React.ReactNode
}) {
  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div
        className="min-h-screen bg-background text-foreground"
        style={{
          fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
          ['--p-bg' as string]: 'hsl(var(--background))',
          ['--p-ink' as string]: 'hsl(var(--foreground))',
          ['--p-surface' as string]: 'hsl(var(--card))',
          ['--p-border' as string]: 'hsl(var(--border))',
          ['--p-accent' as string]: 'hsl(var(--primary))',
          ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className={`mx-auto flex min-h-14 w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 pr-14 sm:px-10 ${bleed ? 'lg:px-16' : 'max-w-[1240px]'}`}>
            <span className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <p className="text-[14px] font-semibold">{clientName}</p>
            <p className="text-[14px] text-muted-foreground">{crumb}</p>
          </div>
        </header>
        <main className={bleed ? 'portal-legible flex w-full flex-col' : 'portal-legible mx-auto flex w-full max-w-[1240px] flex-col gap-8 px-5 py-6 pb-24 sm:px-10 sm:pb-16'}>
          {children}
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
