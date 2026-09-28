import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalApproval } from '../../../../lib/portal-thread'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import SlideCarousel from '../../../../components/media/SlideCarousel'
import ApprovePanel from '../../../../components/portal/ApprovePanel'

export const metadata: Metadata = {
  title: 'For your approval — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * FOR YOUR APPROVAL (the owner, 28 Sep 2026: "the portal is for the approved post, not the boards"; "make sure it
 * looks nice"). The page the "Send to client" email opens: the post — every picture or clip, the caption — and one
 * question, Approve or Ask for a change. No board, no menu, nothing else to find. The client's yes takes the card to
 * Ready to post through the same rules the board uses.
 */
export default async function PortalApprovePage({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalApproval(raw, id)
  if (!data) notFound()
  const { slides, caption, state } = data

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div
        className="min-h-screen bg-background text-foreground"
        style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif' }}
      >
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-5 pb-24 pt-8 sm:px-8 sm:pt-12">
          <header className="flex flex-col gap-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              MD Media · For your approval · {data.client.name}
            </p>
            <h1 className="text-[28px] font-semibold leading-tight sm:text-[34px]">{data.title}</h1>
            {slides.length > 1 && (
              <p className="text-[14px] text-muted-foreground">{slides.length} {slides.every(s => s.type === 'video') ? 'clips' : 'slides'} — swipe or use the arrows to see each one.</p>
            )}
          </header>

          {slides.length > 0 ? (
            <SlideCarousel slides={slides} aspect="natural" mode="full"
              className="overflow-hidden rounded-card border border-border"
              label={`${data.title}${slides.length > 1 ? ` — ${slides.length} slides` : ''}`} />
          ) : (
            <p className="rounded-card border border-dashed border-border p-6 text-center text-[14px] text-muted-foreground">
              The pictures are still being added — check back shortly.
            </p>
          )}

          {caption && (
            <section className="rounded-card border border-border bg-card p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Caption</p>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-[1.55]">{caption}</p>
            </section>
          )}

          <ApprovePanel token={token} itemId={id} state={state} clientName={data.client.name} />

          <p className="text-center text-[12px] text-muted-foreground">
            {data.am_name ? `Questions? Reply to the email — it goes to ${data.am_name}.` : 'Questions? Reply to the email and we’ll get back to you.'}
          </p>
        </main>
      </div>
    </PortalShell>
  )
}
