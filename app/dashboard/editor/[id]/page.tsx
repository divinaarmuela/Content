'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRightLeft, Link as LinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow } from '@/lib/db-client'
import type { Batch, Client, ContentItem } from '@/lib/db-types'
import { useRole } from '../../useRole'
import PageTitle from '../../ui/PageTitle'
import EditorCardDrawer from '../../board/EditorCardDrawer'
import PostApprovalDetail from '../../board/PostApprovalDetail'
import { Button } from '@/components/ui/button'
import { useCardActs } from '../../board/useCardActs'
import { cardActions, type BoardViewCard, type BoardViewer } from '../../../lib/board-view-core'
import FilesToWorkFrom from '../../board/FilesToWorkFrom'
import { usesMakerDrawer } from '../../../lib/card-sheet-core'
import { shootCardId } from '../../../lib/deliverable-group-core'
import { workFrom } from '../../../lib/editor-sop-core'
import { reviewPath } from '../../../lib/video-review-core'
import { canTransferEditing } from '../../../lib/editor-transfer-core'
import TransferEditingDialog from '../../board/TransferEditingDialog'
import { HandToDialog } from '../../board/BoardDialogs'
import { editingPortalPath, editingPortalFolder } from '../../../lib/editing-portal-core'
import { clipApprovalsOf } from '../../../lib/clip-approvals-core'
import { useState } from 'react'

/**
 * A CARD'S OWN PAGE ON THE EDITOR SIDE (the owner, 15 Sep 2026: "make the
 * editor card, when clicked, open a new page displaying the videos'
 * thumbnails so I can view from there" — "not a slider anymore").
 *
 * The board used to open a card in a drawer beside it. Now a press on the
 * Editor page comes here: the files to work from take the wide side — Drive's
 * thumbnails of everything behind the footage folder link, each one playable
 * in place — and the card itself sits beside them: the maker's card for the
 * person holding it (the link box, the checks, the submit, the notes), the
 * manager's card for a manager looking in, the post's card for an uploaded
 * post. The same three cards the drawer chose (card-sheet-core.usesMakerDrawer),
 * on a page instead of a slide-in.
 *
 * Every email and bell link still says /dashboard/editor?card=…; the board
 * turns that into this page.
 */
const folderUrl = (folderId: string) => `https://drive.google.com/drive/folders/${folderId}`

/** The manager's or checker's answers on the card, above the brief: the
 *  board's own buttons and dialogs, so a press here is a press on the board. */
function ManagerActions({ item, viewer, portalLink }: { item: ContentItem; viewer: BoardViewer; portalLink: string | null }) {
  const card = item as unknown as BoardViewCard
  const { busyId, act, dialogs } = useCardActs<BoardViewCard>(viewer)
  const { primary, more } = cardActions(card, viewer)
  const busy = busyId === card.id
  // WITH THE CLIENT: the portal link, to copy and send (the owner, 15 Sep 2026:
  // "there is one card with the client but no client portal button on the card")
  const withClient = String(item.status) === 'client_review' && !!portalLink
  // TRANSFER THE EDITING JOB (the owner, 15 Sep 2026): the client's account
  // manager or a super admin moves the edit — the whole card — to another
  // editor while it is still being made. The route checks the manager is
  // on this client; the button is offered to both manager roles.
  const [transferOpen, setTransferOpen] = useState(false)
  const transferable = canTransferEditing({ id: viewer.id, role: viewer.role, clientIds: null }, item as never)
  // CLIENT APPROVED, AWAITING THE HAND-OVER (the owner, 15 Sep 2026: "it's
  // the AM's or super admin's duty to hand it over to a scheduler"): the
  // approved card is still the editing side's; this is the press that gives
  // it to a scheduler, into their Draft
  const [handOpen, setHandOpen] = useState(false)
  const awaitingHand = String(item.status) === 'approved_for_scheduling' && item.deliver_only !== true
    && ['account_manager', 'super_admin', 'general'].includes(viewer.role)
  if (!primary && more.length === 0 && !withClient && !transferable && !awaitingHand) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3" aria-label="Your answers on this card">
      {primary && (
        <Button disabled={busy} onClick={() => act(card, primary)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full bg-foreground px-4 py-2 text-left text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
          {busy ? 'Saving…' : primary.label}
        </Button>
      )}
      {more.map(a => (
        <Button key={`${a.kind}-${a.to}`} variant="outline" disabled={busy} onClick={() => act(card, a)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border px-4 py-2 text-left text-[13px] font-semibold">
          {a.label}
        </Button>
      ))}
      {withClient && (
        <Button variant="outline" disabled={busy}
          onClick={() => { void navigator.clipboard.writeText(portalLink as string).then(() => toast.success('Portal link copied — send it to the client')).catch(() => toast.error('Could not copy the link')) }}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border px-4 py-2 text-left text-[13px] font-semibold">
          <LinkIcon className="mr-1.5 h-4 w-4" aria-hidden /> Copy the client’s portal link
        </Button>
      )}
      {awaitingHand && (
        <Button disabled={busy} onClick={() => setHandOpen(true)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full bg-foreground px-4 py-2 text-left text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
          Hand to…
        </Button>
      )}
      {awaitingHand && <HandToDialog card={handOpen ? card : null} viewer={viewer} onClose={() => setHandOpen(false)} />}
      {transferable && (
        <Button variant="outline" disabled={busy} onClick={() => setTransferOpen(true)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border px-4 py-2 text-left text-[13px] font-semibold">
          <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden /> Transfer the editing job
        </Button>
      )}
      {transferable && (
        <TransferEditingDialog open={transferOpen} itemId={item.id} itemTitle={item.title} currentOwnerId={item.owner_id ?? null}
          viewerId={viewer.id} onClose={() => setTransferOpen(false)} />
      )}
      {dialogs}
    </div>
  )
}

export default function EditorCardPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { me } = useRole()
  const { row: item, loading } = useRow<ContentItem>('content_items', id)
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  const back = () => router.push('/dashboard/editor')

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!item) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle title="Card not found" summary="It may have been deleted, or the link is not quite right." />
        <Link href="/dashboard/editor" className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Editor
        </Link>
      </div>
    )
  }

  const adhoc = (item as { adhoc_post?: unknown }).adhoc_post === true
  const maker = usesMakerDrawer(me, item)
  const frozen = ['scheduled', 'published'].includes(String(item.status))
  // the shoot's footage only on the card the shoot made (16 Sep 2026)
  const fromPlan = !!item.batch_id && item.id === shootCardId(String(item.batch_id))
  const from = workFrom({
    card: item as never, shoot: shoot as never,
    driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null,
  }, fromPlan)

  return (
    <div className="flex flex-col gap-4">
      <Link href="/dashboard/editor" className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Editor
      </Link>
      <PageTitle
        title={item.title}
        summary={[client?.name, shoot ? `From the shoot: ${shoot.title}` : null].filter(Boolean).join(' · ') || 'A card on the Editor page.'}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)]">
        {/* ── the files, wide: what there is to work from, seen and played here ── */}
        {/* ONE BLOCK, SAID ONCE (the owner, 15 Sep 2026: "why are there multiple
            words of folder to work from"): the files box carries the heading,
            the folder — the card's own, or the shoot's footage folder — the
            Open button, a manager's Add a folder link, and Drive's thumbnails
            of everything behind it, wide, each one playable here */}
        <section className="flex min-w-0 flex-col rounded-card border border-border bg-card" aria-label="Files to work from">
          <FilesToWorkFrom item={item as never} isManager={!adhoc && (me?.role === 'account_manager' || me?.role === 'super_admin')} holder={!!me?.id && item.owner_id === me.id} frozen={frozen} linkOnly
            fallbackFolder={from.footage} wideFiles
            // the clips the client approved on their portal wear a tick (16 Sep 2026)
            approvedIds={clipApprovalsOf(item).map(a => a.file_id)}
            // a press on a clip opens its review page: the clip, the comments, the markers (15 Sep 2026)
            reviewHref={t => reviewPath(id, t.id, t.name)} />
        </section>

        {/* ── the card itself, beside the files ── */}
        {/* the card scrolls inside its own column on a wide screen, so "What happened" at its foot is reachable (the owner, 16 Sep 2026: "on phone I can see the logs but on larger screens I can’t") */}
        <aside className="min-w-0 overflow-hidden rounded-card border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" aria-label="The card">
          {adhoc
            ? <PostApprovalDetail key={id} id={id} onClose={back} />
            : (
              <>
                {!maker && me && me.role !== 'client' && (
                  <ManagerActions item={item} viewer={{ id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true }}
                    // THE EDITING PORTAL (16 Sep 2026): an edit's link opens the client on
                    // its clips and comments; an uploaded post keeps the board link
                    portalLink={client?.share_token
                      ? `${window.location.origin}${editingPortalFolder(item as never) ? editingPortalPath(client.share_token, id) : `/portal/${client.share_token}?card=${encodeURIComponent(id)}`}`
                      : null} />
                )}
                <EditorCardDrawer key={id} id={id} onClose={back} hideFolderFiles />
              </>
            )}
        </aside>
      </div>
    </div>
  )
}
