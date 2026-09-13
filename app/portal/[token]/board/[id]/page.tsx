import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalShootDetail } from '../../../../lib/portal-thread'
import { getPortalDataByToken } from '../../../../lib/portal-data'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PortalLive from '../../../../components/portal/PortalLive'
import ShootBoard from '../../../../components/portal/ShootBoard'

export const metadata: Metadata = {
  title: 'Your board — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * JUST THE BOARD (the owner, 13 Sep 2026: "we already have this feature but
 * this is just the board"). The shoot's planning canvas on its own page,
 * under the MD Media header, and nothing else from the plan: no fields, no
 * approve buttons, no PDF, no general comment box: the client comments ON A
 * CARD (the owner, 13 Sep 2026: "each card we add we can place comments"),
 * the same comment rows as the portal, so the team reads them on the same
 * card on the shoot page and the account manager is emailed.
 *
 * Same token as the client portal, so the "Copy board link" button on the
 * shoot page needs no new secret; an unshared shoot is not found here, as
 * on the portal.
 */
export default async function PortalBoardPage({ params, searchParams }: {
  params: Promise<{ token: string; id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const [data, portal] = await Promise.all([getPortalShootDetail(raw, id), getPortalDataByToken(token)])
  if (!data || !portal) notFound()
  const sp = (await searchParams) ?? {}
  const initialCard = typeof sp.card === 'string' ? sp.card : null

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={portal.client.id} />
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
          <div className="mx-auto flex min-h-14 w-full max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 pr-14 sm:px-10">
            {/* the logo is white and never inverted: it sits on the same dark
                pill the portal uses, readable in both themes (13 Sep 2026) */}
            <span className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <p className="text-[14px] font-semibold">{portal.client.name}</p>
            <p className="text-[14px] text-muted-foreground">{data.shoot.board_name || data.shoot.title}</p>
          </div>
        </header>

        <main className="portal-legible mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-5 py-6 pb-24 sm:px-10 sm:pb-16">
          {data.shoot.canvas_cards.length > 0 ? (
            <ShootBoard
              shootId={data.shoot.id}
              boardName={data.shoot.board_name}
              cards={data.shoot.canvas_cards}
              comments={data.comments}
              surface={{ token }}
              clientName={data.client.name}
              amName={data.am_name}
              initialCardId={initialCard}
            />
          ) : (
            <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">
              Nothing on the board yet — {data.am_name ?? 'your account manager'} will add to it before the shoot.
            </p>
          )}

        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
