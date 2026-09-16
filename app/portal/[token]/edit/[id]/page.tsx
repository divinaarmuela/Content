import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Toaster } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { getEditingPortal } from '../../../../lib/editing-portal'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import EditingReview from '../../../../components/portal/EditingReview'

export const metadata: Metadata = {
  title: 'Your edit — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * THE EDITING PORTAL (the owner, 16 Sep 2026): one editing card on its own
 * page for the client — the clips of the finished edit on the left, their
 * comments on the right, an Approved button per clip. Nothing else: no
 * board, no "in production", no status buttons, no way back to the board
 * ("it should only be for this"). The card is moved by the account manager
 * from the dashboard, never from here. The same light/dark toggle as every
 * portal page (PortalShell), remembered per browser.
 */
export default async function EditingPortalPage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const data = await getEditingPortal(raw, id)
  if (!data) notFound()

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div className="min-h-screen bg-background text-foreground"
        style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif', ['--p-mono-font' as string]: 'var(--font-sometype), monospace' }}>
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="mx-auto flex min-h-14 w-full max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2 pr-16 sm:px-8 sm:pr-8">
            <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground" style={{ fontFamily: 'var(--p-mono-font, monospace)' }}>MD Media · Editing review · {data.portal_name}</span>
            <a href={data.folder.url} target="_blank" rel="noreferrer noopener"
              className="ml-auto inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
              <ExternalLink className="h-4 w-4" aria-hidden /> Open in Drive
            </a>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-5 py-6 pb-24 sm:px-8 sm:pb-16">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-[36px]">{data.item.title}</h1>
            <p className="pb-1 text-[13px] text-muted-foreground">
              {data.clips.length > 0 ? `${data.clips.length} ${data.clips.length === 1 ? 'clip' : 'clips'} · ` : ''}{data.item.status_label}
            </p>
          </div>
          <EditingReview data={data} />
          <p className="text-[12px] text-muted-foreground">
            Your comments and approvals go straight to {data.am_name ?? 'your account manager'}. Approving a clip marks it for the team; the piece itself is moved on by them.
          </p>
        </main>
        <Toaster position="top-center" />
      </div>
    </PortalShell>
  )
}
