import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { getPortalItemDetail } from '../../../../lib/portal-thread'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import CommentThread from '../../../../components/portal/CommentThread'
import { ReviewCard } from '../../../../components/portal/PortalSections'
import { contentTypeLabel } from '../../../../lib/portal-words'

export const metadata: Metadata = {
  title: 'Your content — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * One piece of content, on its own page: the preview and a persistent
 * comment thread the client and the team share. No popups — the
 * conversation lives here.
 */
export default async function PortalItemPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const data = await getPortalItemDetail(raw, id)
  if (!data) notFound()
  const token = decodeURIComponent(raw).split('--').pop() ?? raw

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div style={{
        fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif',
        ['--p-heading-font' as string]: 'var(--font-archivo), sans-serif',
        ['--p-mono-font' as string]: 'var(--font-sometype), monospace',
      }}>
        <header className="sticky top-0 z-20 backdrop-blur" style={{ background: 'color-mix(in srgb, var(--p-bg) 85%, transparent)', borderBottom: '1px solid var(--p-border)' }}>
          <div className="flex h-12 items-center gap-3 px-6 sm:px-10">
            <Link href={`/portal/${token}`} className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] opacity-70 hover:opacity-100"
              style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              ← {data.client.name}
            </Link>
            <p className="ml-auto shrink-0 text-[9px] uppercase tracking-[0.2em] opacity-40" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              by MD Media
            </p>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-12 sm:px-10">
          <div className="flex flex-col gap-3">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-50" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              {[contentTypeLabel(data.item.content_type), data.item.status_label].filter(Boolean).join(' · ')}
            </p>
            <h1 className="text-3xl font-medium tracking-tight" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>
              {data.item.title}
            </h1>
          </div>

          {/* the decision lives wherever the piece is — clicking the title to
              look properly used to cost the client their two buttons */}
          {data.item.status === 'client_review' ? (
            <ReviewCard item={data.item} token={token} amName={data.am_name} bare />
          ) : data.item.preview_url ? (
            <div className="overflow-hidden rounded-xl" style={{ background: '#0a0a0a' }}>
              {/\.(mp4|webm|mov)(\?|$)/i.test(data.item.preview_url) ? (
                <video src={data.item.preview_url} controls playsInline preload="metadata" className="max-h-[70vh] w-full object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={data.item.preview_url} alt="" className="max-h-[70vh] w-full object-contain" />
              )}
            </div>
          ) : null}

          <CommentThread token={token} kind="item" id={data.item.id} comments={data.comments} />
        </main>
        <Toaster position="bottom-right" />
      </div>
    </PortalShell>
  )
}
