'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal } from 'lucide-react'
import { useProductionLive } from '../../useProductionLive'
import {
  actingRoles, presentTransitions, whoseTurn, type ItemStatus,
} from '../../../../lib/workflow-core'
import type { Role } from '../../../../lib/identity-core'
import {
  availableBriefTaskTransitionsAs, BRIEF_STATUS_MEANING, BRIEF_STATUS_TURN,
} from '../../../../lib/brief-task-core'

/**
 * The shoot plan's review lifecycle — moved here from the item page so a plan
 * lives on ONE page. It reuses the SAME state machine (brief-task-core's pure
 * edges + workflow-core's whoseTurn/presentTransitions) and the SAME transition
 * endpoint the item page called; nothing about the workflow changes, only where
 * the buttons live.
 *
 * The final "Book the shoot" step is deliberately NOT a button here: locking
 * the shoot date (the page's own Book action) already carries an approved plan
 * to "Shoot booked" server-side, so a second booking button would be two
 * controls for one move.
 */

type ReviewComment = {
  id: string; created_at: string; author_name?: string | null
  visibility: string; body: string
}
type ClientUser = { name: string; email: string }
type Reviewer = { id: string; name: string; email: string; role: string; assigned: boolean }

type BriefDetail = {
  id: string; status: ItemStatus
  client_id: string; client_name: string | null
  viewer_id?: string; viewer_role: Role; acting_roles?: Role[]
  owner_id: string | null; owner_name?: string | null
  assigned_by?: string | null
  scheduler_ids?: string[] | null
  client_approval_required: boolean
  brief_url?: string | null
  batch?: { id: string; status?: string; concept?: string | null; shot_list?: unknown[] | null } | null
  client_users?: ClientUser[]
  comments?: ReviewComment[]
  work_kind?: { slug: string; uses_media?: boolean } | null
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export default function PlanReviewCard({ briefItemId, planHasContent, onChanged }: {
  briefItemId: string
  /**
   * The shoot page's LIVE concept-or-shot-list state, lifted in so "Send plan
   * for review" re-derives the moment the user writes the concept or adds a
   * shot — the card fetches the brief once on mount, and that stale snapshot
   * used to keep the button greyed until a full reload. undefined = the parent
   * did not pass it, and the card falls back to its own fetched snapshot.
   */
  planHasContent?: boolean
  /** reload the shoot page so its own state (booked chip, items) keeps up */
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<BriefDetail | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  // the three review dialogs — identical to the item page's
  const [reviewPick, setReviewPick] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [reviewers, setReviewers] = useState<Reviewer[] | null>(null)
  const [reviewersFailed, setReviewersFailed] = useState(false)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [clientSend, setClientSend] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [revisionAsk, setRevisionAsk] = useState<{ to: ItemStatus; label: string } | null>(null)
  const [revisionNote, setRevisionNote] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/items/${briefItemId}`, { cache: 'no-store' })
      if (!res.ok) return
      setDetail(await res.json() as BriefDetail)
    } catch { /* a dropped read is not a reason to blank the card */ }
  }, [briefItemId])
  useEffect(() => { void load() }, [load])
  // the client approving on their portal, or a teammate moving it, lands here
  // without a reload — the same live behaviour the item page had
  useProductionLive(useCallback((change?: { item_id: string }) => {
    if (!change || change.item_id === briefItemId) void load()
  }, [briefItemId, load]))

  if (!detail) {
    return <Card><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
  }

  const role = detail.viewer_role
  if (role === 'client') return null
  const viewer = { id: detail.viewer_id ?? '', role }
  const workItem = {
    id: detail.id, status: detail.status,
    owner_id: detail.owner_id ?? null,
    scheduler_ids: detail.scheduler_ids,
    work_kinds: detail.work_kind ? { slug: detail.work_kind.slug, uses_media: detail.work_kind.uses_media } : null,
  }
  const hats = detail.acting_roles ?? actingRoles(viewer, workItem)

  // the plan's own edges, judged by the brief rules — then drop the final
  // "Book the shoot" (scheduled) edge: booking is the page's Book button, and
  // locking the date already advances an approved plan to booked server-side
  const transitions = availableBriefTaskTransitionsAs(hats, detail.status)
    .filter(t => t.to !== 'scheduled')
  const turn = whoseTurn(detail.status, workItem, viewer, BRIEF_STATUS_TURN)
  const { primary, secondary } = presentTransitions(
    hats, detail.status, transitions,
    { clientApprovalRequired: detail.client_approval_required !== false, viewerHoldsTurn: turn.mine },
    BRIEF_STATUS_TURN,
  )
  const meaning = BRIEF_STATUS_MEANING[detail.status]

  const turnText = (): string => {
    if (turn.hat === null) return 'nobody — the shoot is booked'
    if (turn.unassigned) return 'Unassigned — an account manager will pick it up'
    if (turn.mine) return 'you'
    if (turn.hat === 'client') return 'the client'
    if (turn.hat === 'editor') return `${detail.owner_name ?? 'the editor'}`
    return 'the account manager'
  }

  // the SAME rule the server enforces (brief-task-core's briefSatisfiesSubmission:
  // a plan link OR concept OR a shot). `planHasContent` is the parent's live
  // concept/shot-list state, so the button reacts as the user writes — the
  // fetched snapshot is only the fallback for the plan link and first paint.
  const briefHasContent = planHasContent === true || Boolean(
    detail.brief_url?.trim()
    || detail.batch?.concept?.trim()
    || (detail.batch?.shot_list?.length ?? 0) > 0,
  )
  const blockedReason = (to: ItemStatus): string | null => {
    if (to === 'internal_review' && !briefHasContent) {
      return 'Add a plan link, or write the concept or shot list above first.'
    }
    return null
  }

  const successText = (to: ItemStatus, label: string): string => {
    const client = detail.client_name ?? 'the client'
    switch (to) {
      case 'internal_review': return 'Plan sent for review'
      case 'revision_required': return 'Sent back for changes — they have been told'
      case 'revision_complete': return 'Marked as revised — back with the reviewer'
      case 'client_review': return `Shared with ${client} — it is on their portal now`
      case 'client_changes_requested': return "The client's changes are logged"
      case 'approved_for_scheduling': return 'Plan approved — now book the shoot with the Book button above'
      default: return label
    }
  }

  const doTransition = async (to: ItemStatus, label: string, notifyIds?: string[], note?: string) => {
    setBusy(to)
    setDialogError(null)
    try {
      const res = await fetch(`/api/production/items/${briefItemId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to,
          ...(notifyIds?.length ? { notify_ids: notifyIds } : {}),
          ...(note?.trim() ? { note: note.trim() } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `${label} failed`)
      toast.success(successText(to, label))
      setReviewPick(null); setClientSend(null); setRevisionAsk(null); setRevisionNote('')
      // put the write's own answer on the card now, then reconcile
      setDetail(d => (d ? { ...d, status: (json.status as ItemStatus) ?? d.status } : d))
      await load()
      onChanged()
    } catch (e) {
      const msg = e instanceof Error ? e.message : `${label} failed`
      if (/^No transition from /.test(msg)) {
        toast.error('That move isn’t available any more — the plan just changed. Reloading.')
        setReviewPick(null); setClientSend(null); setRevisionAsk(null)
        await load(); onChanged()
      } else {
        toast.error(msg)
        setDialogError(msg)
      }
    } finally {
      setBusy(null)
    }
  }

  /** the same reviewer picker the item page opened for a submit edge */
  const openReviewerPick = async (t: { to: ItemStatus; label: string }) => {
    setReviewPick(t); setDialogError(null); setReviewers(null); setReviewersFailed(false)
    try {
      const res = await fetch(`/api/clients/${detail.client_id}/managers`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load reviewers')
      const assignedIds = new Set<string>((json.managers ?? []).map((m: { team_user_id: string }) => m.team_user_id))
      const list: Reviewer[] = (json.eligible ?? [])
        .filter((u: { id: string; role: string }) =>
          u.id !== detail.viewer_id && (u.role === 'super_admin' || assignedIds.has(u.id)))
        .map((u: { id: string; name: string; email: string; role: string }) => ({ ...u, assigned: assignedIds.has(u.id) }))
      list.sort((a, b) => Number(b.assigned) - Number(a.assigned) || (a.name || a.email).localeCompare(b.name || b.email))
      setReviewers(list)
      const defaults = new Set(list.filter(r => r.assigned).map(r => r.id))
      if (detail.assigned_by && list.some(r => r.id === detail.assigned_by)) defaults.add(detail.assigned_by)
      setChosen(defaults)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load reviewers')
      setReviewers([]); setReviewersFailed(true)
    }
  }

  const soloReviewer = reviewers?.length === 0 && !reviewersFailed && hats.includes('account_manager')

  const press = (t: { to: ItemStatus; label: string }) =>
    (t.to === 'internal_review' || t.to === 'revision_complete')
      ? void openReviewerPick(t)
      : (t.to === 'revision_required' || t.to === 'client_changes_requested')
        ? (setRevisionAsk(t), setRevisionNote(''), setDialogError(null))
        : t.to === 'client_review'
          ? (setClientSend(t), setDialogError(null))
          : void doTransition(t.to, t.label)

  const actionButton = (t: { to: ItemStatus; label: string }, variant: 'default' | 'outline') => (
    <Button key={t.to} size="sm" variant={variant} className="min-h-11 md:min-h-8"
      disabled={busy !== null || blockedReason(t.to) !== null}
      onClick={() => press(t)}>
      {busy === t.to ? 'Working…' : t.label}
    </Button>
  )

  // the request-changes reasons and other review notes, read back on the one
  // page so nothing that used to live on the item page's thread is lost. The
  // client conversation stays in the Comments box below (the portal thread).
  const reviewNotes = (detail.comments ?? []).filter(c => c.visibility === 'internal').slice(0, 4)
  const hints = [...new Set([...(primary ? [primary] : []), ...secondary]
    .map(t => blockedReason(t.to)).filter(Boolean))] as string[]

  return (
    <>
      <Card className="border-zinc-300 dark:border-zinc-700">
        <CardContent className="flex flex-col gap-2.5 p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
            What&rsquo;s the next move
          </p>
          <p className="text-sm">
            <span className="font-medium">{meaning}</span>{' '}
            {turn.hat !== null && (
              turn.mine
                ? <span className="text-emerald-700 dark:text-emerald-400">That&rsquo;s you.</span>
                : <span className="text-zinc-500 dark:text-zinc-400">Waiting on {turnText()}.</span>
            )}
          </p>
          {transitions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {primary && actionButton(primary, 'default')}
              {secondary.length === 1 && actionButton(secondary[0], 'outline')}
              {secondary.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="min-h-11 md:min-h-8" aria-label="Other moves" disabled={busy !== null}>
                      <MoreHorizontal className="h-4 w-4" /> More
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {secondary.map(t => (
                      <DropdownMenuItem key={t.to} disabled={blockedReason(t.to) !== null}
                        onClick={() => press(t)}>
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
          {hints.map(h => (
            <p key={h} className="text-xs text-amber-600 dark:text-amber-400">{h}</p>
          ))}
          {reviewNotes.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Review notes</p>
              {reviewNotes.map(c => (
                <p key={c.id} className="text-xs text-zinc-600 dark:text-zinc-300">
                  <span className="font-medium">{c.author_name ?? 'Team'}</span>
                  <span className="text-zinc-400 dark:text-zinc-500"> · {when(c.created_at)}</span>
                  <span className="block whitespace-pre-wrap">{c.body}</span>
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* who should review this? — same picker the item page used */}
      <Dialog open={reviewPick !== null} onOpenChange={o => !o && busy === null && setReviewPick(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{reviewPick?.label}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Who should review this? They&rsquo;ll be emailed as your reviewer.</p>
            {reviewers === null && (
              <div className="flex flex-col gap-2 py-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
            )}
            {reviewersFailed ? (
              <div className="flex flex-col items-center gap-2 py-4">
                <p className="text-sm text-zinc-400 dark:text-zinc-500">Couldn&rsquo;t load reviewers — try again</p>
                <Button variant="outline" size="sm" className="min-h-11" disabled={busy !== null}
                  onClick={() => reviewPick && void openReviewerPick(reviewPick)}>Try again</Button>
              </div>
            ) : reviewers?.length === 0 && (
              <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
                {soloReviewer ? 'You’re the only reviewer on this client.' : 'Nobody else to notify on this client — the move is still recorded.'}
              </p>
            )}
            {(reviewers ?? []).map(r => (
              <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50">
                <input type="checkbox" checked={chosen.has(r.id)}
                  onChange={() => setChosen(prev => { const n = new Set(prev); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })}
                  className="h-4 w-4 shrink-0 accent-blue-600" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name || r.email}</span>
                  <span className="block truncate text-xs text-zinc-400 dark:text-zinc-500">{r.email}</span>
                  <span className="block text-xs text-zinc-400 dark:text-zinc-500">
                    {r.role === 'super_admin' ? 'Super admin' : 'Account manager'}{r.assigned && ' · manages this client'}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{dialogError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setReviewPick(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11" disabled={busy !== null || reviewers === null || reviewersFailed}
              onClick={() => reviewPick && void doTransition(reviewPick.to, reviewPick.label, [...chosen])}>
              {busy !== null ? 'Working…' : soloReviewer ? 'Send it and review it myself' : chosen.size > 0 ? `Send to ${chosen.size} reviewer${chosen.size > 1 ? 's' : ''}` : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* about to reach the client — say who, and what they will see */}
      <Dialog open={clientSend !== null} onOpenChange={o => !o && busy === null && setClientSend(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Send to {detail.client_name ?? 'the client'}?</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            {(detail.client_users?.length ?? 0) > 0 ? (
              <p>{detail.client_users!.length} portal {detail.client_users!.length === 1 ? 'user' : 'users'} will be emailed: {detail.client_users!.map(u => u.name || u.email).join(', ')}.</p>
            ) : (
              <p>This client has no portal account yet, so no email goes out — but the plan still moves to their side and appears the moment one is created.</p>
            )}
            <p className="text-zinc-500 dark:text-zinc-400">The plan becomes visible on their portal, where they can approve it or ask for changes.</p>
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{dialogError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setClientSend(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11" disabled={busy !== null}
              onClick={() => clientSend && void doTransition(clientSend.to, clientSend.label)}>
              {busy !== null ? 'Working…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* what needs to change? — the note rides the revision request */}
      <Dialog open={revisionAsk !== null} onOpenChange={o => !o && busy === null && setRevisionAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{revisionAsk?.label}</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Say what needs to change — it lands in the comments and in {detail.owner_name ? `${detail.owner_name}’s` : 'the assignee’s'} email.
            </p>
            <textarea value={revisionNote} onChange={e => setRevisionNote(e.target.value)} rows={4} autoFocus
              placeholder="What should be different in the next version?"
              className="w-full resize-y rounded-md border border-zinc-200 bg-transparent p-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600" />
          </div>
          {dialogError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">{dialogError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setRevisionAsk(null)} disabled={busy !== null}>Cancel</Button>
            <Button className="min-h-11" disabled={busy !== null}
              onClick={() => revisionAsk && void doTransition(revisionAsk.to, revisionAsk.label, undefined, revisionNote)}>
              {busy !== null ? 'Working…' : revisionAsk?.label}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
