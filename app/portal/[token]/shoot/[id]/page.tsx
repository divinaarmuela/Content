import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalShootDetail } from '../../../../lib/portal-thread'
import { getPortalDataByToken } from '../../../../lib/portal-data'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PortalLive from '../../../../components/portal/PortalLive'
import { PortalCardView } from '../../../../components/portal/PortalBoard'
import ShootBoard from '../../../../components/portal/ShootBoard'
import CommentThread from '../../../../components/portal/CommentThread'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * One shoot, on its own page — the full-screen view of what the portal
 * already shows under the shoot: the same card (the plan, the PDF, the one
 * tap to approve), the planning board open with a thread on every card, and
 * the shoot's own conversation. No popups. Kept current live.
 */
export default async function PortalShootPage({ params, searchParams }: {
  params: Promise<{ token: string; id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const [data, portal] = await Promise.all([getPortalShootDetail(raw, id), getPortalDataByToken(token)])
  if (!data || !portal) notFound()
  const card = portal.cards.find(c => c.kind === 'shoot' && c.id === id)
  if (!card) notFound()
  const sp = (await searchParams) ?? {}
  const initialCard = typeof sp.card === 'string' ? sp.card : null

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <PortalLive clientId={portal.client.id} />
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
          ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
        }}
      >
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-5 pr-14 sm:px-10">
            <Link href={`/portal/${token}`} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold">
              ← {portal.client.name}
            </Link>
          </div>
        </header>

        <main className="portal-legible mx-auto flex w-full max-w-[1400px] flex-col gap-8 px-5 py-8 pb-24 sm:px-10 sm:pb-16">
          <PortalCardView card={card} amName={portal.am_name} surface={{ token }} className="max-w-3xl" />

          {data.shoot.canvas_cards.length > 0 && (
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
          )}

          <div className="max-w-3xl">
            <CommentThread token={token} kind="shoot" id={data.shoot.id} comments={data.comments} />
          </div>
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
