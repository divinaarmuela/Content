'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRightLeft, Link as LinkIcon, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useRow } from '@/lib/db-client'
import type { Batch, Client, ContentItem, WorkKind } from '@/lib/db-types'
import { useRole } from '../../useRole'
import PageTitle from '../../ui/PageTitle'
import EditorCardDrawer from '../../board/EditorCardDrawer'
import PostApprovalDetail from '../../board/PostApprovalDetail'
import { Button } from '@/components/ui/button'
import { useCardActs } from '../../board/useCardActs'
import { cardActions, type BoardViewCard, type BoardViewer, type CardAction } from '../../../lib/board-view-core'
import { splitPlan } from '../../../lib/split-core'
import FilesToWorkFrom from '../../board/FilesToWorkFrom'
import ShareAcceptedLink from '../../board/ShareAcceptedLink'
import { usesMakerDrawer } from '../../../lib/card-sheet-core'
import { shootCardId } from '../../../lib/deliverable-group-core'
import { cardUsesPlan, workFrom } from '../../../lib/editor-sop-core'
import { reviewPath } from '../../../lib/video-review-core'
import { canTransferEditing } from '../../../lib/editor-transfer-core'
import TransferEditingDialog from '../../board/TransferEditingDialog'
import { HandToDialog } from '../../board/BoardDialogs'
import { editingPortalPath, portalHasWork } from '../../../lib/editing-portal-core'
import { clipApprovalsOf } from '../../../lib/clip-approvals-core'
import { deliverOnly } from '../../../lib/deliver-only-core'
import { useEffect, useRef, useState } from 'react'
import { ColourGradePanel } from '../../board/ColourGradePanel'
import { HolderTransfer, ManagerActions } from '../../board/CardAnswers'
import { SplitPanel } from '../../board/SplitPanel'
import { onePortalPath, workTab } from '../../../lib/one-portal-core'
import { NotifyClientButton } from '../../board/NotifyClientDialog'

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

/**
 * THE CARD'S COLUMN ENDS AT THE BOTTOM OF THE SCREEN, WHEREVER IT STARTS (5 Oct 2026: "it's a bit hard to see the
 * brief — I need to scroll outside the two windows to scroll the remaining"). The column scrolls inside itself,
 * and was given the whole screen's height — but it starts below the page's title, so its last few hundred pixels
 * hung off the bottom of the screen and the end of a long brief could only be reached by scrolling the PAGE.
 * Its height is now what is actually left under its top edge, kept right as the page scrolls or resizes.
 */
function useFitsScreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wide = window.matchMedia('(min-width: 1024px)')
    const fit = () => {
      if (!wide.matches) { el.style.maxHeight = ''; return }
      const top = Math.max(16, el.getBoundingClientRect().top)
      el.style.maxHeight = `${Math.max(240, window.innerHeight - top - 16)}px`
    }
    fit()
    // capture: the dashboard's own scrolling box does not bubble its scroll to the window
    window.addEventListener('scroll', fit, { capture: true, passive: true })
    window.addEventListener('resize', fit)
    wide.addEventListener('change', fit)
    return () => {
      window.removeEventListener('scroll', fit, { capture: true })
      window.removeEventListener('resize', fit)
      wide.removeEventListener('change', fit)
    }
  })
  return ref
}

export default function EditorCardPage() {
  const cardColumn = useFitsScreen<HTMLElement>()
  const { id } = useParams<{ id: string }>()
  // WHEN A PERSON LAST OPENED A CARD (21 Sep 2026): stamped for the board's "Last viewed" order, fire and forget
  useEffect(() => {
    if (!id) return
    void fetch(`/api/production/items/${id}/viewed`, { method: 'POST' }).catch(() => { /* the order is a convenience */ })
  }, [id])
  const router = useRouter()
  const { me } = useRole()
  const { row: item, loading } = useRow<ContentItem>('content_items', id)
  const { row: shoot } = useRow<Batch>('batches', item?.batch_id ?? null)
  const { row: client } = useRow<Client>('clients', item?.client_id ?? null)
  // a designer's card (17 Sep 2026): files both ways, never a Drive link
  const { row: kind, loading: kindLoading } = useRow<WorkKind>('work_kinds', item?.work_kind_id ?? null)
  // files are everybody's hand-in now (22 Sep 2026), so this asks the narrower thing: is it a designer's card
  const filesOnly = !!item && (kind as { slug?: string } | null)?.slug === 'graphics'
  // THE BOARD THIS CARD CAME FROM (22 Sep 2026): the same page serves /dashboard/designer/<id>
  const pathname = usePathname()
  const board = pathname?.startsWith('/dashboard/designer') ? { href: '/dashboard/designer', word: 'Designer' } : { href: '/dashboard/editor', word: 'Editor' }
  const back = () => router.push(board.href)
  // A DESIGNER'S CARD OPENS ON THE DESIGNER BOARD (the owner, 28 Sep 2026: "did we fix the designer page flow"): every
  // email, bell and ?card= link builds /dashboard/editor/<id>, so a graphics card landed under Editor with an Editor
  // back link. The card knows its kind — it moves itself to its own board's address.
  useEffect(() => {
    if (filesOnly && id && pathname === `/dashboard/editor/${id}`) router.replace(`/dashboard/designer/${id}`)
  }, [filesOnly, id, pathname, router])

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
  // the shoot's footage on the card the shoot made, or a hand-made card that asked for the plan (16 Sep 2026)
  const fromPlan = cardUsesPlan(item as never, shootCardId)
  const from = workFrom({
    card: item as never, shoot: shoot as never,
    driveFolderUrl: client?.drive_folder_id ? folderUrl(String(client.drive_folder_id)) : null,
  }, fromPlan)

  return (
    <div className="flex flex-col gap-4">
      <Link href={board.href} className="inline-flex min-h-11 w-fit items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {board.word}
      </Link>
      <PageTitle
        title={item.title}
        summary={[client?.name, shoot ? `From the shoot: ${shoot.title}` : null].filter(Boolean).join(' · ') || `A card on the ${board.word} page.`}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)]">
        {/* ── the files, wide: what there is to work from, seen and played here ── */}
        {/* ONE BLOCK, SAID ONCE (the owner, 15 Sep 2026: "why are there multiple
            words of folder to work from"): the files box carries the heading,
            the folder — the card's own, or the shoot's footage folder — the
            Open button, a manager's Add a folder link, and Drive's thumbnails
            of everything behind it, wide, each one playable here */}
        <section className="flex min-w-0 flex-col rounded-card border border-border bg-card" aria-label="Files to work from">
          {/* drawn once the kind is known, so a designer's card never flashes the folder-link button */}
          {kindLoading && <Skeleton className="m-4 h-40 rounded-inner" />}
          {!kindLoading && <FilesToWorkFrom item={item as never} isManager={!adhoc && (me?.role === 'account_manager' || me?.role === 'super_admin')} holder={!!me?.id && item.owner_id === me.id} frozen={frozen} linkOnly filesOnly={filesOnly}
            fallbackFolder={from.footage} wideFiles versions
            // the clips the client approved on their portal wear a tick (16 Sep 2026)
            approvedIds={clipApprovalsOf(item).map(a => a.file_id)}
            // a press on a clip opens its review page: the clip, the comments, the markers (15 Sep 2026)
            reviewHref={t => reviewPath(id, t.id, t.name)} />}
          {/* THE PUBLIC LINK FOR THE ACCEPTED VERSION (share-link-core, 17 Sep 2026) — anyone on the team, once the card is accepted */}
          <ShareAcceptedLink item={item as never} />
        </section>

        {/* ── the card itself, beside the files ── */}
        {/* the card scrolls inside its own column on a wide screen, so "What happened" at its foot is reachable (the owner, 16 Sep 2026: "on phone I can see the logs but on larger screens I can’t") */}
        <aside ref={cardColumn} className="min-w-0 overflow-hidden rounded-card border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" aria-label="The card">
          {adhoc
            ? <PostApprovalDetail key={id} id={id} onClose={back} />
            : (
              <>
                {!maker && me && me.role !== 'client' && (
                  <ColourGradePanel item={item as never} mayGrade={me.role === 'account_manager' || me.role === 'super_admin' || me.colourist === true} />
                )}
                {!maker && me && me.role !== 'client' && (
                  <SplitPanel item={item as never} mayDecide={me.role === 'account_manager' || me.role === 'super_admin'} />
                )}
                {!maker && me && me.role !== 'client' && (
                  <ManagerActions design={filesOnly} item={item} client={client ?? null} viewer={{ id: me.id, role: me.role, quality_reviewer: me.quality_reviewer === true, colourist: me.colourist === true }} kindSlug={(kind as { slug?: string } | null)?.slug ?? null}
                    // THE EDITING PORTAL (16 Sep 2026): an edit's link opens the client on
                    // its clips and comments; an uploaded post keeps the board link
                    // …on the one portal, this card's own page in its tab (the owner, 2 Oct 2026: "we can copy it and send it for that page in that card")
                    portalLink={client?.share_token
                      ? `${window.location.origin}${(client as { portal_one?: unknown }).portal_one === true ? onePortalPath(client.share_token, workTab((kind as { slug?: string } | null)?.slug ?? null), id) : portalHasWork(item as never) ? editingPortalPath(client.share_token, id) : `/portal/${client.share_token}?card=${encodeURIComponent(id)}`}`
                      : null} />
                )}
                {maker && me && <HolderTransfer design={filesOnly} item={item} viewer={{ id: me.id, role: me.role }} />}
                <EditorCardDrawer key={id} id={id} onClose={back} hideFolderFiles />
              </>
            )}
        </aside>
      </div>
    </div>
  )
}
