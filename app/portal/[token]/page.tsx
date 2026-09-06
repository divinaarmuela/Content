import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalDataByToken, type PortalCard } from '../../lib/portal-data'
import { archivo, sometype } from '../../components/lama/fonts'
import Reveal from '../../components/lama/Reveal'
import Rule from '../../components/lama/Rule'
import { Scramble } from '../../components/lama/Scramble'
import PortalShell from '../../components/portal/PortalShell'
import PortalLive from '../../components/portal/PortalLive'
import PortalSectionsView from '../../components/portal/PortalSectionsView'
import PortalTabbedView from '../../components/portal/PortalTabbedView'
import { PortalHelpLine } from '../../components/portal/PortalSections'
import { heroCounts } from '../../lib/portal-core'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// always fresh — share links are checked live, no caching of client data
export const dynamic = 'force-dynamic'

/**
 * The client portal, from a share link — the layout the owner asked back
 * for: the client's name in giant type over their own work, four counters,
 * a sticky strip with their name once scrolled, then the page top to bottom:
 * what needs them, their shoots with the planning board open under each,
 * what is being made, what is approved and booked, what is live. Today's
 * cards inside (one tap to approve, comments pinned to everything), and the
 * page keeps itself current.
 */

/** The most recent piece with visible media — the hero backdrop. */
function heroMedia(cards: PortalCard[]): string | null {
  for (const c of cards) if (c.preview_url) return c.preview_url
  return null
}

const COUNTERS: [keyof ReturnType<typeof heroCounts>, string][] = [
  ['review', 'Needs your review'],
  ['production', 'In production'],
  ['approved', 'Approved & scheduled'],
  ['published', 'Published'],
]

export default async function SharedPortalPage({ params, searchParams }: {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalDataByToken(token)
  if (!data) notFound()
  const sp = (await searchParams) ?? {}
  const initialCard = typeof sp.card === 'string' ? sp.card : null

  const counts = heroCounts(data.cards)
  const hero = heroMedia(data.cards)
  const words = data.client.name.trim().split(/\s+/)
  const lastWord = words.length > 1 ? words.pop()! : null
  const firstWords = words.join(' ')

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={data.client.id} />
      {/* the cards and the board are painted from the dashboard's tokens
          (bg-surface, text-foreground…), which follow `.dark` on <html> —
          PortalShell puts it there. The portal's own chrome reads --p-*;
          pointed at the same tokens here, one switch moves the whole page. */}
      <div
        className="bg-background text-foreground"
        style={{
          fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
          ['--p-bg' as string]: 'hsl(var(--background))',
          ['--p-ink' as string]: 'hsl(var(--foreground))',
          ['--p-surface' as string]: 'hsl(var(--card))',
          ['--p-border' as string]: 'hsl(var(--border))',
          ['--p-accent' as string]: 'hsl(var(--primary))',
          ['--p-accent-ink' as string]: 'hsl(var(--primary-foreground))',
          ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        {/* ── hero: the client's name over their own work ── */}
        <div className="relative overflow-hidden" style={{ background: '#000' }} data-portal-hero>
          {hero && (
            <div className="absolute inset-0">
              {/\.(mp4|webm|mov)(\?|$)/i.test(hero) ? (
                <video src={hero} autoPlay muted loop playsInline className="h-full w-full object-cover opacity-50" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero} alt="" className="h-full w-full object-cover opacity-50" />
              )}
              <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, #0B0B0B 6%, rgba(11,11,11,0.55) 45%, rgba(11,11,11,0.2) 100%)' }} />
            </div>
          )}
          <div className="absolute left-5 top-5 z-10 sm:left-10">
            <div className="flex w-fit items-center rounded-lg bg-gradient-to-b from-zinc-800 to-zinc-950 px-2.5 py-2 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/MDLogo-trim.png" alt="MD Media" className="h-3.5 w-auto" />
            </div>
          </div>
          <div className="relative flex min-h-[300px] flex-col justify-end px-5 pb-8 pt-24 text-cream sm:min-h-[420px] sm:px-10 sm:pb-10">
            <Scramble
              gate={false}
              text="CONTENT PORTAL"
              className="mb-4 block text-[11px] uppercase tracking-[0.24em] [word-spacing:0.45em]"
              as="p"
            />
            <Reveal gate={false}>
              <h1 className="font-medium uppercase leading-[1.0] tracking-[-0.04em] text-[clamp(2.2rem,7vw,6rem)]">
                {firstWords}
                {lastWord && (
                  <>
                    {' '}
                    <span className="bg-cream px-[0.12em] py-[0.02em] text-ink [box-decoration-break:clone] [-webkit-box-decoration-break:clone]">
                      {lastWord}
                    </span>
                  </>
                )}
              </h1>
            </Reveal>
            <Reveal gate={false} delay={160}>
              {/* two even columns on a phone; the counters, the headings and
                  the chips are the SAME four words — a client counting "01"
                  finds the section that says it */}
              <div className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-3" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
                {COUNTERS.map(([key, label]) => (
                  <div key={key} data-counter={key}>
                    <p className="text-[9px] uppercase tracking-[0.2em] opacity-50">{label}</p>
                    <p className="text-lg tabular-nums" style={{ opacity: counts[key] > 0 ? 1 : 0.35 }}>
                      {String(counts[key]).padStart(2, '0')}
                    </p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>

        {/* ── sticky mini-header once scrolled past the hero ── */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          {/* pr-14 on mobile: the mode pill docks into this strip below sm */}
          <div className="flex h-12 items-center gap-3 px-5 pr-14 sm:px-10">
            <div className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
            </div>
            <p className="truncate text-sm font-medium uppercase tracking-tight">{data.client.name}</p>
            <p className="ml-auto hidden shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40 sm:block" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              by MD Media
            </p>
          </div>
        </header>

        {/* an intake tab appears only when a form is toggled on; with none,
            this renders the overview alone */}
        <PortalTabbedView intake={data.intake}>
          <main className="portal-legible flex w-full flex-col gap-12 px-5 py-10 sm:gap-16 sm:px-10 sm:py-14">
            <Reveal gate={false}>
              <PortalSectionsView data={data} surface={{ token }} initialCardId={initialCard} />
            </Reveal>
          </main>
        </PortalTabbedView>

        {/* pb-24 keeps the fixed mode pill off the last line of the page */}
        <footer className="px-5 pb-24 sm:px-10 sm:pb-10">
          <Rule className="mb-6 bg-current opacity-30" once />
          <PortalHelpLine amName={data.am_name} className="mb-3 text-muted-foreground opacity-100" />
          <p className="text-[12px] uppercase tracking-[0.14em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
            MD Media · get seen · get known · get booked
          </p>
        </footer>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
