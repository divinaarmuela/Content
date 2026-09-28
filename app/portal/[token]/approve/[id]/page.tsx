import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPortalApproval } from '../../../../lib/portal-thread'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PostReview from '../../../../components/portal/PostReview'

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
export default async function PortalApprovePage({ params, searchParams }: {
  params: Promise<{ token: string; id: string }>
  searchParams: Promise<{ preview?: string }>
}) {
  const { token: raw, id } = await params
  // PREVIEW: the team sees exactly what the client will, with the answer switched off (28 Sep 2026)
  const preview = (await searchParams).preview === '1'
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const data = await getPortalApproval(raw, id, { preview })
  if (!data) notFound()
  const { slides, caption, state, typeLine, whenLine, whereLine, kind, missed } = data

  return (
    <PortalShell className={`dbx ${archivo.variable} ${sometype.variable}`}>
      <div
        className="min-h-screen bg-background text-foreground"
        style={{ fontFamily: 'var(--font-archivo), Helvetica, Arial, sans-serif' }}
      >
        <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-5 pb-24 pt-6 sm:px-8 sm:pt-10">
          <header className="flex flex-col gap-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground" style={{ fontFamily: 'var(--font-sometype), monospace' }}>
              MD Media · For your approval · {data.client.name}
            </p>
            <h1 className="text-[26px] font-semibold leading-tight sm:text-[32px]">{data.title}</h1>
          </header>
          {preview && (
            <p className="rounded-inner border border-accent-amber/40 bg-tint-amber px-3 py-2 text-[13px]">Preview — this is exactly what the client sees. Approve and notes are switched off here.</p>
          )}
          {/* ONE LAYOUT for every way a client reaches a post (28 Sep 2026): the post on the left, one slide at a time;
              the details, the notes on that slide and the answer on the right, in view */}
          <PostReview token={token} itemId={id} title={data.title} slides={slides} caption={caption} typeLine={typeLine}
            whenLine={whenLine} whereLine={whereLine} missed={missed === true} state={state} kind={kind} preview={preview}
            clientName={data.client.name} comments={data.comments} />
        </main>
      </div>
    </PortalShell>
  )
}
