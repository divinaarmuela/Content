import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getPortalApproval, portalPostForItem } from '../../../../lib/portal-thread'
import { portalPostHref } from '../../../../lib/post-page-core'
import { editingPortalItem } from '../../../../lib/editing-portal'
import { editingPortalPath } from '../../../../lib/editing-portal-core'
import { archivo, sometype } from '../../../../components/lama/fonts'
import PortalShell from '../../../../components/portal/PortalShell'
import PostReview from '../../../../components/portal/PostReview'

export const metadata: Metadata = {
  title: 'For your approval — MD Media',
  robots: 'noindex, nofollow',
}
export const dynamic = 'force-dynamic'

/**
 * FOR YOUR APPROVAL — the EDIT's page (the owner, 28 Sep 2026: "the portal is for the approved post, not the
 * boards"; "make sure it looks nice"): every picture or clip, the notes on each, and one question.
 *
 * Since the posting rebuild (29 Sep 2026) a POST has its own page, `/portal/<token>/post/<post id>`, read from the
 * post's stage and the version the client was sent. A link from before, which names the piece rather than the post,
 * goes to that piece's post when the client has one to see — never to a post they were not sent (audit P3). There
 * is no `?preview=1` here any more: the team's look is on the post page, and only for a signed-in team member
 * (audit P4).
 */
export default async function PortalApprovePage({ params }: {
  params: Promise<{ token: string; id: string }>
}) {
  const { token: raw, id } = await params
  const token = decodeURIComponent(raw).split('--').pop() ?? raw
  const postId = await portalPostForItem(raw, id).catch(() => null)
  if (postId) redirect(portalPostHref(token, postId))
  // AN EDIT OPENS ITS VERSIONS PAGE (the owner, 30 Sep 2026: "versions page + ask for a change"): the email and the
  // board link here, and this page has no versions, no earlier cut with its comments, no approval per clip — the
  // editing page has all of it and the answer on the whole piece too. A post uploaded for approval stays here.
  const edit = await editingPortalItem(raw, id).catch(() => null)
  if (edit) redirect(editingPortalPath(raw, id))
  const data = await getPortalApproval(raw, id)
  if (!data) notFound()
  const { slides, caption, state, typeLine, whenLine, whereLine, kind } = data

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
          {data.unfrozen && (
            <p className="rounded-inner border border-border bg-card px-3 py-2 text-[13px] text-muted-foreground">
              Sent before versions were kept — these are the files as they are now.
            </p>
          )}
          {/* ONE LAYOUT for every way a client reaches a piece (28 Sep 2026): the piece on the left, one slide at a
              time; the details, the notes on that slide and the answer on the right, in view */}
          <PostReview token={token} itemId={id} title={data.title} slides={slides} caption={caption} typeLine={typeLine}
            whenLine={whenLine} whereLine={whereLine} missed={false} state={state} kind={kind} preview={false}
            clientName={data.client.name} comments={data.comments} />
        </main>
      </div>
    </PortalShell>
  )
}
