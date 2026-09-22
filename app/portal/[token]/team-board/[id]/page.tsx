import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalTeamBoardDetail } from '../../../../lib/portal-team-board'
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
 * A TEAM BOARD, ON THE CLIENT'S PORTAL (the owner, 22 Sep 2026: "when we
 * show to client, can they leave comments, like how we do for shoot
 * briefs"). The same page as the shoot's board: the canvas as the team drew
 * it, under the MD Media header, and the client comments ON A CARD — the
 * same rows the team reads on the board page, and the account managers are
 * emailed. Same token as the client portal, so "Copy client link" on the
 * board needs no new secret; a board not shared with them is not found.
 */
export default async function PortalTeamBoardPage({ params, searchParams }: {
  params: Promise<{ token: string; id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const [data, portal] = await Promise.all([getPortalTeamBoardDetail(raw, id), getPortalDataByToken(token)])
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
            <span className="flex shrink-0 items-center rounded-md bg-gradient-to-b from-zinc-800 to-zinc-950 px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/MDLogo-trim.png" alt="MD Media" className="h-2.5 w-auto" />
            </span>
            <span aria-hidden className="text-muted-foreground">·</span>
            <p className="text-[14px] font-semibold">{portal.client.name}</p>
            <p className="text-[14px] text-muted-foreground">{data.board.name}</p>
          </div>
        </header>

        <main className="portal-legible mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-5 py-6 pb-24 sm:px-10 sm:pb-16">
          {data.board.canvas_cards.length > 0 ? (
            <ShootBoard
              shootId={data.board.id}
              thread="team_board"
              boardName={data.board.name}
              cards={data.board.canvas_cards}
              comments={data.comments}
              surface={{ token }}
              clientName={data.client.name}
              amName={data.am_name}
              initialCardId={initialCard}
            />
          ) : (
            <p className="rounded-card border border-border bg-card p-6 text-[15px] text-muted-foreground">
              Nothing on the board yet — {data.am_name ?? 'your account manager'} will add to it.
            </p>
          )}
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
