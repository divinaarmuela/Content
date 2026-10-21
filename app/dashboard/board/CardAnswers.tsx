'use client'

import { useState } from 'react'
import { ArrowRightLeft, Link as LinkIcon, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Client, ContentItem } from '@/lib/db-types'
import { useCardActs } from './useCardActs'
import { cardActions, type BoardViewCard, type BoardViewer, type CardAction } from '../../lib/board-view-core'
import { splitPlan } from '../../lib/split-core'
import { canTransferEditing } from '../../lib/editor-transfer-core'
import TransferEditingDialog from './TransferEditingDialog'
import { HandToDialog } from './BoardDialogs'
import { deliverOnly } from '../../lib/deliver-only-core'
import { NotifyClientButton } from './NotifyClientDialog'

/**
 * THE CARD'S ANSWERS — the buttons a manager, checker or holder presses on an Editor card. Shared by the live
 * Editor card page and the Editor preview (the owner, 22 Oct 2026: "make sure you know the current process"), so
 * both pages move a card the one way.
 */

/**
 * A MANAGER HOLDING THE CARD CAN STILL GIVE IT AWAY (the owner, 21 Sep 2026:
 * "how come super admins and AMs can't transfer the editing job"). A manager
 * who holds a card in Draft or back for changes gets the maker's card — the
 * link box, the submit — and the manager's buttons, Transfer among them, were
 * left off it. The one press they need is here; the route decides as before.
 */
export function HolderTransfer({ item, viewer, design = false }: { item: ContentItem; viewer: { id: string; role: string }; design?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!canTransferEditing({ id: viewer.id, role: viewer.role, clientIds: null }, item as never)) return null
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
      <p className="min-w-0 flex-1 text-[13px] text-muted-foreground">You hold this card. Someone else can take the {design ? 'design' : 'editing'}, with everything on it.</p>
      <Button variant="outline" onClick={() => setOpen(true)} className="h-11 rounded-full px-4 text-[14px] font-semibold">
        <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden /> {design ? 'Transfer the design job' : 'Transfer the editing job'}
      </Button>
      <TransferEditingDialog open={open} itemId={item.id} itemTitle={item.title} currentOwnerId={item.owner_id ?? null}
        viewerId={viewer.id} onClose={() => setOpen(false)} design={design} />
    </div>
  )
}

/** The manager's or checker's answers on the card, above the brief: the
 *  board's own buttons and dialogs, so a press here is a press on the board. */
export function ManagerActions({ item, viewer, portalLink, client, design = false, kindSlug = null }: { item: ContentItem; viewer: BoardViewer; portalLink: string | null; client: Client | null; design?: boolean; kindSlug?: string | null }) {
  // the work kind rides on the card, so a video edit's check offers colour grade (docs/COLOUR_GRADE_SPLIT_SPEC.md C1)
  const card = { ...(item as unknown as BoardViewCard), work_kinds: kindSlug ? { name: kindSlug, slug: kindSlug } : null } as BoardViewCard
  const { busyId, act, dialogs } = useCardActs<BoardViewCard>(viewer)
  const actions = cardActions(card, viewer)
  // SOME APPROVED, NOT ALL (3 Oct 2026: "all buttons make sense?" — beside Split, "Log the client's approval" and "Send
  // back for changes" read as acting on the unapproved ones; they act on the whole card): they say "all N"
  const part = splitPlan(item as never)
  const whole = part.kind === 'split' ? part.approved.length + part.open.length : null
  const sayAll = (a: CardAction): CardAction => whole === null ? a
    : a.kind === 'send_back' ? { ...a, label: `Send all ${whole} back for changes` }
    : a.kind === 'transition' && a.to === 'approved_for_scheduling' ? { ...a, label: `${a.label} — all ${whole}` }
    : a
  const primary = actions.primary ? sayAll(actions.primary) : null
  const more = actions.more.map(sayAll)
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
  // NOBODY ON THE CARD (the owner, 16 Sep 2026: "sometimes we have yet to set
  // the editor — make sure the super admin or the AM knows who's on it: no
  // one, and can assign, not just 'not yet'"): the same route, the plain
  // press — the first person on the card, not a transfer
  const unassigned = transferable && !item.owner_id
  // DELIVERY ONLY, ON THE EDITING CARD (the owner, 16 Sep 2026: "where is the
  // option on the editing card to tick it as editing only, not handing to a
  // scheduler?"): the same tick the post's card has — the card ends at the
  // client's approval and no scheduler is ever handed it. A manager's tick,
  // while the card is still on the editing side.
  const isManager = viewer.role === 'account_manager' || viewer.role === 'super_admin'
  const frozen = ['scheduled', 'published'].includes(String(item.status))
  const [savingDeliver, setSavingDeliver] = useState(false)
  const setDeliverOnly = async (on: boolean) => {
    setSavingDeliver(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deliver_only: on }),
      })
      if (!res.ok) throw new Error('Could not change that')
      toast.success(on ? 'Delivery only — the client posts this themselves; it ends at their approval' : 'We post this one — it is handed to a scheduler after approval')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change that')
    } finally { setSavingDeliver(false) }
  }
  const [savingHidden, setSavingHidden] = useState(false)
  const setPortalHidden = async (on: boolean) => {
    setSavingHidden(true)
    try {
      const res = await fetch(`/api/production/items/${item.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ portal_hidden: on }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not change that')
      toast.success(on ? 'Taken off the client’s portal — they will not see it there' : 'Back on the client’s portal')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change that')
    } finally { setSavingHidden(false) }
  }
  // CLIENT APPROVED, AWAITING THE HAND-OVER (the owner, 15 Sep 2026: "it's
  // the AM's or super admin's duty to hand it over to a scheduler"): the
  // approved card is still the editing side's; this is the press that gives
  // it to a scheduler, into their Draft
  const [handOpen, setHandOpen] = useState(false)
  const awaitingHand = String(item.status) === 'approved_for_scheduling' && item.deliver_only !== true
    && ['account_manager', 'super_admin', 'general'].includes(viewer.role)
  if (!primary && more.length === 0 && !withClient && !transferable && !awaitingHand && !isManager) return null
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
      {/* NOTIFY THE CLIENT (2 Oct 2026): putting it on the portal emails nobody; this press does — that card's own link */}
      {withClient && (client as { portal_one?: unknown } | null)?.portal_one === true && (
        <NotifyClientButton clientId={item.client_id} tab={design ? 'designing' : 'editing'} id={item.id}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border px-4 py-2 text-left text-[13px] font-semibold" />
      )}
      {awaitingHand && (
        <Button disabled={busy} onClick={() => setHandOpen(true)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full bg-foreground px-4 py-2 text-left text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
          Hand to…
        </Button>
      )}
      {awaitingHand && <HandToDialog card={handOpen ? card : null} viewer={viewer} onClose={() => setHandOpen(false)} />}
      {unassigned && (
        <Button disabled={busy} onClick={() => setTransferOpen(true)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full bg-foreground px-4 py-2 text-left text-[13px] font-semibold text-background hover:bg-foreground/90 disabled:opacity-60">
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> {design ? 'Assign a designer' : 'Assign an editor'}
        </Button>
      )}
      {transferable && !unassigned && (
        <Button variant="outline" disabled={busy} onClick={() => setTransferOpen(true)}
          className="h-auto min-h-11 max-w-full whitespace-normal rounded-full border-border px-4 py-2 text-left text-[13px] font-semibold">
          <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden /> {design ? 'Transfer the design job' : 'Transfer the editing job'}
        </Button>
      )}
      {transferable && (
        <TransferEditingDialog open={transferOpen} itemId={item.id} itemTitle={item.title} currentOwnerId={item.owner_id ?? null}
          viewerId={viewer.id} onClose={() => setTransferOpen(false)} design={design} />
      )}
      {/* the one portal: an edit or design shows there on its own; a manager may take it off (2 Oct 2026) */}
      {(viewer.role === 'account_manager' || viewer.role === 'super_admin') && (client as { portal_one?: unknown } | null)?.portal_one === true && (
        <label className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-[13px]" data-portal-hidden>
          <input type="checkbox" className="h-4 w-4 accent-foreground" disabled={savingHidden}
            checked={(item as { portal_hidden?: unknown }).portal_hidden === true}
            onChange={e => void setPortalHidden(e.target.checked)} />
          <span>Take it off the client&apos;s portal — they will not see it there.</span>
        </label>
      )}
      {isManager && !frozen && (
        <label className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-[13px]" data-deliver-only>
          <input type="checkbox" className="h-4 w-4 accent-foreground" disabled={savingDeliver}
            checked={deliverOnly(item as { deliver_only?: unknown }, client as { posts_own_content?: unknown } | null)}
            onChange={e => void setDeliverOnly(e.target.checked)} />
          <span>Delivery only — the client posts this themselves. It ends at their approval; nothing goes to a scheduler.</span>
          {client?.posts_own_content === true && item.deliver_only == null && <span className="text-muted-foreground">(the client’s setting)</span>}
        </label>
      )}
      {dialogs}
    </div>
  )
}

