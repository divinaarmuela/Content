import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { onePortalRedirect } from '../../../../lib/one-portal-redirect'
import { Toaster } from 'sonner'
import { getPortalApproval, getPortalItemDetail } from '../../../../lib/portal-thread'
import { getPortalDataByToken } from '../../../../lib/portal-data'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import { PortalCardView } from '../../../../components/portal/PortalBoard'
import CommentThread from '../../../../components/portal/CommentThread'
import SlideCarousel from '../../../../components/media/SlideCarousel'
import { slidesFor } from '../../../../lib/slide-carousel-core'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * One piece, on its own page: the whole post at full size, the same card as
 * on the board (link, one tap to approve), and the conversation about it.
 */
export default async function PortalItemPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  // a client on the one portal: this old address opens the same thing inside their one link
  const moved = await onePortalRedirect(raw, { kind: 'item', id })
  if (moved) redirect(moved)
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  // ONE LINK, ONE PAGE (the owner, 28 Sep 2026: "clients have two links now"): a piece with something to look at
  // opens the review page — the post, the notes on each slide, the answer — whichever link the client followed
  const approval = await getPortalApproval(raw, id).catch(() => null)
  if (approval && approval.slides.length > 0) redirect(`/portal/${raw}/approve/${id}`)
  const [data, portal] = await Promise.all([getPortalItemDetail(raw, id), getPortalDataByToken(token)])
  if (!data || !portal) notFound()
  const card = portal.cards.find(c => c.kind === 'work' && c.id === id)
  if (!card) notFound()
  const slides = slidesFor(data.item)

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
          {slides.length > 0 && (
            // the whole post at full size — the page the client opens when
            // they want to look properly is where every card of a carousel is
            <SlideCarousel slides={slides} aspect="natural" mode="full"
              className="overflow-hidden rounded-inner"
              label={`${data.item.title}${slides.length > 1 ? ` — ${slides.length} slides` : ''}`} />
          )}
          <PortalCardView card={{ ...card, preview_url: null }} amName={portal.am_name} surface={{ token }} />
          <div className="portal-legible">
            <CommentThread token={token} kind="item" id={data.item.id} comments={data.comments} />
          </div>
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
