'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  APPROVAL_GROUPS, APPROVALS_EMPTY, approvalRows,
  type ApprovalItem, type ApprovalRow, type ScheduleView,
} from '../../../lib/schedule-page-core'
import { mayApprovePost } from '../../../lib/posting-approval-core'
import { actingRoles } from '../../../lib/workflow-core'
import { friendlyError } from '../../../lib/support-core'
import { useWorkRows } from '../../useLiveWork'
import { useRole } from '../../useRole'
import { AccountUnavailable } from '../../production/shoot-ui'
import type { ScopeViewer } from '../../../lib/scope-client'

/**
 * APPROVALS: the one place anything waiting on a person appears.
 *
 * Before this there were three places to look and no way to see the lot: a
 * post sent for sign-off lived on the item page, work with the client lived
 * in a board column, and the number of pieces still waiting was a grey chip
 * on the calendar's media rail that went nowhere. Somebody asking "what is
 * waiting on me?" had to walk all three.
 *
 * Three kinds, one list (`approvalRows`), and each row opens the thing it is
 * about — the composer on its preview for a post, the card's own panel for a
 * card. Nothing new is decided here: Approve and Ask for a change call the
 * SAME route the item page and the client's portal call, so a yes given from
 * this screen is the same yes, with the same emails and the same trail.
 *
 * The client picker is the calendar's, remembered under the same key, so
 * following the rail's "Waiting for approval" chip lands you on that client's
 * list rather than everybody's.
 */

const CLIENT_KEY = 'md-schedule-client'
const ALL = '__all__'

export default function ApprovalsView({ go }: {
  /** hand the page over to another view, carrying what the link needs */
  go: (view: ScheduleView, extra?: Record<string, string | null | undefined>) => void
}) {
  const { me, noAccount } = useRole()
  const viewer = useMemo<ScopeViewer | null>(
    () => (me && me.role !== 'client' ? { id: me.id, role: me.role } : null), [me])
  const live = useWorkRows(viewer, { schedulerPostFilter: false })

  /**
   * Whose list this is. `?client=` first — the chip and the bell both name a
   * client — then the one this person had on the calendar, then everybody.
   * Read once, lazily, for the same reason the calendar does: an effect that
   * restored the remembered client would race the link and win.
   */
  const [clientId, setClientId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      const named = new URLSearchParams(window.location.search).get('client')
      if (named) return named
      return localStorage.getItem(CLIENT_KEY)
    } catch { return null }
  })

  const pickClient = (id: string) => {
    const next = id === ALL ? null : id
    setClientId(next)
    try {
      if (next) localStorage.setItem(CLIENT_KEY, next)
    } catch { /* private mode */ }
  }

  const clientName = useMemo(
    () => new Map(live.clients.map(c => [c.id, c.name])), [live.clients])

  /** the client picked is only real while this person can still see them */
  const known = clientId && live.clients.some(c => c.id === clientId) ? clientId : null

  const rows = useMemo(
    () => approvalRows(live.items as unknown as ApprovalItem[], { clientId: known }),
    [live.items, known])

  /** which rows this viewer may answer on the spot: the post gate, judged by
   *  the hats they wear ON THAT ITEM — the same pair the server asks */
  const canAnswer = useMemo(() => {
    const out = new Set<string>()
    if (!viewer) return out
    for (const item of live.items) {
      if (mayApprovePost(actingRoles(viewer, item))) out.add(item.id)
    }
    return out
  }, [live.items, viewer])

  if (noAccount) return <AccountUnavailable />

  const loading = viewer === null || live.loading

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={known ?? ALL} onValueChange={pickClient}>
          <SelectTrigger className="h-11 w-[220px] shrink-0 rounded-full border-border bg-surface text-[13px] font-semibold">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All clients</SelectItem>
            {live.clients.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-[13px] font-semibold text-muted-foreground">
          {rows.length === 1 ? '1 thing waiting' : `${rows.length} things waiting`}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-5 py-10 text-center text-[15px] text-muted-foreground">
          {APPROVALS_EMPTY}
        </p>
      ) : (
        APPROVAL_GROUPS.map(group => {
          const inGroup = rows.filter(r => r.kind === group.kind)
          if (inGroup.length === 0) return null
          return (
            <section key={group.kind} className="flex flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-section-title">{group.label}</h2>
                <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">
                  {inGroup.length}
                </span>
                <p className="w-full text-[13px] text-muted-foreground sm:w-auto">{group.blurb}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {inGroup.map(row => (
                  <ApprovalCard
                    key={`${row.kind}:${row.itemId}`}
                    row={row}
                    clientName={clientName.get(row.clientId) ?? null}
                    mayAnswer={row.kind === 'post' && canAnswer.has(row.itemId)}
                    go={go}
                  />
                ))}
              </ul>
            </section>
          )
        })
      )}
    </div>
  )
}

/**
 * One thing waiting, and the way in to it.
 *
 * A post opens the composer on its preview — the screen the answer is
 * actually given on, with the frames as they would go out. A card opens the
 * card's own panel beside the board, which is where its buttons have always
 * been. Neither is a new screen.
 */
function ApprovalCard({ row, clientName, mayAnswer, go }: {
  row: ApprovalRow
  clientName: string | null
  mayAnswer: boolean
  go: (view: ScheduleView, extra?: Record<string, string | null | undefined>) => void
}) {
  const [busy, setBusy] = useState<'approve' | 'change' | null>(null)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')

  const open = () => {
    if (row.kind === 'post') go('calendar', { client: row.clientId, item: row.itemId })
    else go('board', { client: row.clientId, card: row.itemId })
  }

  const answer = async (what: 'approve' | 'change') => {
    const words = note.trim()
    if (what === 'change' && !words) {
      toast.error('Say what needs changing — a few words is enough')
      return
    }
    setBusy(what)
    try {
      const res = await fetch(`/api/production/items/${row.itemId}/posting-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: what === 'approve' ? 'approve' : 'request_changes',
          ...(words ? { note: words } : {}),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(friendlyError(String(json?.error ?? ''), 'Schedule'))
      toast.success(what === 'approve'
        ? 'Approved — it can go out as you saw it.'
        : 'Sent back with what to change.')
      setAsking(false)
      setNote('')
      // the row leaves this list by itself: the item is a live listener
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send that')
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={open}
            className="text-left text-[15px] font-semibold leading-tight hover:underline"
          >
            {row.title}
          </button>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {clientName ? `${clientName} · ` : ''}{row.what} · {row.who}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={open}
            className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted"
          >
            {row.kind === 'post' ? 'See the post' : 'Open the card'}
          </button>
          {mayAnswer && (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void answer('approve')}
                className="flex min-h-11 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
              >
                <Check className="h-4 w-4" strokeWidth={2.2} aria-hidden />
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
              <button
                type="button"
                aria-expanded={asking}
                disabled={busy !== null}
                onClick={() => setAsking(v => !v)}
                className={cn(
                  'flex min-h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-semibold disabled:opacity-60',
                  asking ? 'bg-muted' : 'bg-surface hover:bg-muted',
                )}
              >
                <MessageSquare className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                Ask for a change
              </button>
            </>
          )}
        </div>
      </div>

      {asking && (
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-semibold" htmlFor={`note-${row.itemId}`}>
            What needs changing?
          </label>
          <textarea
            id={`note-${row.itemId}`}
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="A few words is enough."
            className="w-full rounded-inner border border-border bg-paper p-3 text-[14px]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setAsking(false); setNote('') }}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold"
            >
              Not now
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void answer('change')}
              className="min-h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60"
            >
              {busy === 'change' ? 'Sending…' : 'Send it back'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
