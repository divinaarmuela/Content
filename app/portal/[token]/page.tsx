import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalDataByToken } from '../../lib/portal-data'
import { archivo, sometype } from '../../components/lama/fonts'
import PortalShell from '../../components/portal/PortalShell'
import PortalBoard from '../../components/portal/PortalBoard'
import { CommitmentCards, PortalHelpLine, PostReviewSection } from '../../components/portal/PortalSections'
import PortalTabbedView from '../../components/portal/PortalTabbedView'
import { columnCounts, PORTAL_COLUMNS } from '../../lib/portal-core'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow', // secret-link page — never indexed
}

// always fresh — share links are checked live, no caching of client data
export const dynamic = 'force-dynamic'

/**
 * The client portal, from a share link. It opens on the client's BOARD: one
 * card per piece and per shoot, in the five columns named for what they mean
 * to a client, in the client's own brand. The card that is with them carries
 * the link and the one tap to approve.
 */
export default async function SharedPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalDataByToken(token)
  if (!data) notFound()

  const counts = columnCounts(data.cards)

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      {/* the older portal blocks (the final-post card, the month tiles) are
          painted from --p-* variables; pointed at the dashboard's tokens they
          follow the same light/dark switch as the board. These resolve
          through hsl(var(--background)) at paint time, so the toggle still
          reaches them — see PortalShell for why a literal colour here would
          not. */}
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
        {/* ── the top strip: their logo or their name, and who made it ── */}
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          {/* pr-14 on a phone: the theme pill docks into this strip below sm */}
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-5 pr-14 sm:px-10">
            {data.brand_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.brand_logo_url} alt={data.client.name} className="h-7 w-auto max-w-[140px] object-contain" />
            ) : (
              <p className="truncate text-[15px] font-semibold tracking-tight">{data.client.name}</p>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
              <span className="hidden sm:inline">made with</span>
              <span className="flex items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
              </span>
            </span>
          </div>
        </header>

        <PortalTabbedView intake={data.intake}>
          <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-10 px-5 py-8 sm:px-10 sm:py-10">
            {/* the five numbers, in the columns' own words — a client counting
                "2" finds the column that says it */}
            <div className="grid grid-cols-5 gap-2">
              {PORTAL_COLUMNS.map(c => (
                <div key={c.key} className="min-w-0">
                  <p className="text-[22px] font-bold tabular-nums leading-none sm:text-[30px]" style={{ opacity: counts[c.key] > 0 ? 1 : 0.3 }}>
                    {counts[c.key]}
                  </p>
                  <p className="mt-1 truncate text-[12px] font-medium text-muted-foreground sm:text-[13px]">{c.title}</p>
                </div>
              ))}
            </div>

            <PortalBoard
              cards={data.cards}
              clientName={data.client.name}
              amName={data.am_name}
              brand={data.brand}
              logoUrl={null}
              surface={{ token }}
            />

            {/* the FINAL POST — caption and timing — waiting on the client.
                A different decision from approving the work, and its own
                pile says so. Drawn only when something is waiting. */}
            {data.post_approvals.length > 0 && (
              <div className="portal-legible">
                <PostReviewSection items={data.post_approvals} token={token} amName={data.am_name} tz={data.client.timezone} />
              </div>
            )}

            <div className="portal-legible"><CommitmentCards data={data} /></div>
          </main>
        </PortalTabbedView>

        {/* pb-24 keeps the fixed theme pill off the last line of the page */}
        <footer className="mx-auto w-full max-w-[1400px] border-t border-border px-5 pb-24 pt-6 sm:px-10 sm:pb-10">
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
