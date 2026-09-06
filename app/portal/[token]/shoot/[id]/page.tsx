import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalShootDetail } from '../../../../lib/portal-thread'
import { getPortalDataByToken } from '../../../../lib/portal-data'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import { PortalCardView } from '../../../../components/portal/PortalBoard'
import CommentThread from '../../../../components/portal/CommentThread'
import BriefCanvas from '../../../../dashboard/production/shoots/[id]/BriefCanvas'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * One shoot, on its own page: the same card as on the board (the plan, the
 * PDF, the one tap to approve), the planning board when it was shared, and
 * the shoot's comment thread. No popups.
 */
export default async function PortalShootPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const [data, portal] = await Promise.all([getPortalShootDetail(raw, id), getPortalDataByToken(decodeURIComponent(raw).split('--').pop() ?? raw)])
  if (!data || !portal) notFound()
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const card = portal.cards.find(c => c.kind === 'shoot' && c.id === id)
  if (!card) notFound()

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
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
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-5 pr-14 sm:px-10">
            <Link href={`/portal/${token}`} className="inline-flex min-h-11 items-center gap-2 text-[14px] font-semibold">
              ← Your board
            </Link>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-8 pb-24 sm:px-10 sm:pb-16">
          <PortalCardView card={card} amName={portal.am_name} surface={{ token }} />

          {data.shoot.canvas_cards.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-[17px] font-semibold">{data.shoot.board_name || 'The planning board'}</h2>
              {/* the canvas reads `.dark` from <html>, where PortalShell puts
                  the choice, so it follows the page */}
              <div className="overflow-hidden rounded-inner border border-border">
                <BriefCanvas cards={data.shoot.canvas_cards} references={[]} canEdit={false}
                  clientName={data.client.name} onOp={async () => false} />
              </div>
            </section>
          )}

          <div className="portal-legible">
            <CommentThread token={token} kind="shoot" id={data.shoot.id} comments={data.comments} />
          </div>
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
