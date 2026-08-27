'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Calendar, Check, ChevronDown, FileDown, MapPin, MessageCircle } from 'lucide-react'
import BriefCanvas from '../../dashboard/production/shoots/[id]/BriefCanvas'
import { SectionHeading } from './PortalSections'
import type { PortalShoot } from '../../lib/portal-data'
import {
  approvePlanConsequence, changesSentToast, contentTypeLabel, contentTypePlural,
  PLAN_APPROVED_TOAST, PLAN_STATE_LINE, type PlanState,
} from '../../lib/portal-words'

const dateLabel = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to be confirmed'

/**
 * SHOOT PLANS — the shoots an account manager chose to share. Summary,
 * deliverables, shot list, and a read-only pan/zoom view of the planning
 * board. The board keeps its own light look inside the portal, framed like
 * a piece of work rather than restyled.
 */
export default function ShootSection({ shoots, clientName, token, amName, loggedIn, onActed, bare }: {
  shoots: PortalShoot[]
  clientName?: string
  token?: string
  amName?: string | null
  /** signed-in portal: no share token, but the viewer IS the client and acts
   *  through the normal item API */
  loggedIn?: boolean
  /** the signed-in portal holds its data in state — tell it to reload */
  onActed?: () => void
  /** one shoot on its own page — "SHOOT PLANS 01" over a single plan reads
   *  like a list that lost its list */
  bare?: boolean
}) {
  if (shoots.length === 0) return null
  const cards = (
    <div className="flex flex-col gap-10">
      {shoots.map(s => (
        <ShootCard key={s.id} shoot={s} clientName={clientName} token={token} amName={amName}
          loggedIn={loggedIn} onActed={onActed} bare={bare} />
      ))}
    </div>
  )
  if (bare) return cards
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading count={shoots.length}>SHOOT PLANS</SectionHeading>
      {cards}
    </section>
  )
}

function ShootCard({ shoot, clientName, token, amName, loggedIn, onActed, bare }: {
  shoot: PortalShoot; clientName?: string; token?: string; amName?: string | null
  loggedIn?: boolean; onActed?: () => void
  /** already ON the plan's own page — no link back to where you are */
  bare?: boolean
}) {
  const router = useRouter()
  const [boardOpen, setBoardOpen] = useState(false)
  const done = shoot.shot_list.filter(r => r.done).length

  // the plan is with the client for a decision — the state machine says it is
  // their turn, so the two moves have to be here, on the plan
  const decide = shoot.awaiting_decision
  /**
   * What the card says about the client's own decision.
   *
   * `acted` is the optimistic half: the server has taken the decision but this
   * page is still holding the data it was rendered with, and a client who has
   * just pressed a button must not be shown the same button again. It wins
   * over the server's answer until the reload brings one that agrees.
   */
  const [acted, setActed] = useState<PlanState>(null)
  const server = shoot.plan_state ?? null
  const state: PlanState = acted ?? server
  /** their move AND a move they can actually make from this page */
  const canAct = state === 'awaiting_you' && Boolean(token || loggedIn) && Boolean(decide)
  /** "This plan is with you" with no buttons under it is a dead end — a
   *  read-only viewer is shown nothing rather than an invitation they cannot
   *  accept */
  const showState = state !== null && (state !== 'awaiting_you' || canAct)
  const [mode, setMode] = useState<null | 'changes'>(null)
  const [note, setNote] = useState('')
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('mdm-portal-name') ?? '')
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (action: 'approve' | 'request_changes') => {
    if ((!token && !loggedIn) || !decide) return
    if (action === 'request_changes') {
      if (!note.trim()) return toast.error('Write what should change first')
      if (token && !name.trim()) return toast.error('Add your name so the team knows who asked')
    }
    if (name.trim()) localStorage.setItem('mdm-portal-name', name.trim())
    setBusy(action)
    try {
      if (token) {
        const res = await fetch('/api/portal/act', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, item_id: decide.item_id, action, comment: note, author_name: name.trim() }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      } else {
        // signed-in client: the same two moves through the item API — the
        // note goes first so the manager has the context with the status
        if (note.trim()) {
          const c = await fetch(`/api/production/items/${decide.item_id}/comments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: note.trim() }),
          })
          if (!c.ok) throw new Error((await c.json()).error ?? 'Could not send your note')
        }
        const t = await fetch(`/api/production/items/${decide.item_id}/transition`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: action === 'approve' ? 'approved_for_scheduling' : 'client_changes_requested' }),
        })
        if (!t.ok) throw new Error((await t.json()).error ?? 'Something went wrong')
      }
      toast.success(action === 'approve' ? PLAN_APPROVED_TOAST : changesSentToast(amName))
      // the card answers immediately, and keeps answering after the reload:
      // the server's own plan_state says the same thing from then on
      setActed(action === 'approve' ? 'approved' : 'changes_sent')
      setNote('')
      setMode(null)
      router.refresh()
      onActed?.()
    } catch (e) {
      if (e instanceof TypeError) {
        toast.message('Connection hiccup — refreshing to check…')
        router.refresh()
      } else {
        toast.error(e instanceof Error ? e.message : 'Something went wrong')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <article
      className="flex flex-col gap-5 border p-5 sm:p-6"
      style={{ borderColor: 'var(--p-border)', background: 'var(--p-surface)' }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {token && shoot.details_shared ? (
          <Link href={`/portal/${token}/shoot/${shoot.id}`}
            className="portal-tap text-lg font-medium tracking-tight underline-offset-4 hover:underline"
            style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>
            {shoot.title}
          </Link>
        ) : (
          <h3 className="text-lg font-medium tracking-tight" style={{ fontFamily: 'var(--p-heading-font, inherit)' }}>
            {shoot.title}
          </h3>
        )}
        <span
          className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em]"
          style={{ fontFamily: 'var(--p-mono-font, inherit)', background: 'var(--p-accent)', color: 'var(--p-accent-ink)' }}
        >
          {shoot.status_label}
        </span>
        {/* on a phone the date and location get the full row rather than
            being squeezed against the status chip by `ml-auto` */}
        <span className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 text-xs opacity-70 sm:ml-auto sm:w-auto" style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
          <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /> {dateLabel(shoot.shoot_date)}</span>
          {shoot.location && <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {shoot.location}</span>}
        </span>
      </div>

      {shoot.concept && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed opacity-90">{shoot.concept}</p>
      )}

      {token && shoot.details_shared && (
        <a
          href={`/api/portal/shoot-pdf?token=${encodeURIComponent(token)}&id=${shoot.id}`}
          className="portal-tap flex w-fit items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] opacity-70 transition-opacity hover:opacity-100"
          style={{ fontFamily: 'var(--p-mono-font, inherit)' }}
        >
          <FileDown className="h-3.5 w-3.5" /> Download the shoot plan (PDF)
        </a>
      )}

      {shoot.planned_deliverables.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shoot.planned_deliverables.map(d => (
            <span key={d.type} className="border px-2 py-1 text-[11px] uppercase tracking-wider"
              style={{ borderColor: 'var(--p-border)', fontFamily: 'var(--p-mono-font, inherit)' }}>
              {d.qty} {d.qty > 1 ? contentTypePlural(d.type).toLowerCase() : (contentTypeLabel(d.type) ?? 'piece').toLowerCase()}
            </span>
          ))}
        </div>
      )}

      {shoot.shot_list.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.18em] opacity-50" style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
            Shot list {done > 0 && `· ${done}/${shoot.shot_list.length} captured`}
          </p>
          <ul className="flex flex-col gap-1">
            {shoot.shot_list.map(r => (
              <li key={r.id} className="flex items-center gap-2.5 text-sm">
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center border"
                  style={{ borderColor: 'var(--p-border)', opacity: r.done ? 1 : 0.5 }}
                >
                  {r.done && <Check className="h-3 w-3" />}
                </span>
                <span style={{ opacity: r.done ? 0.65 : 1 }}>
                  {r.text}
                  {r.qty ? <span className="opacity-50"> ×{r.qty}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* what the client's own decision did, said back to them. The buttons
          appear only while it is genuinely their move; every other state is a
          sentence, because "I pressed the button, did it work?" is the only
          question a portal has to be able to answer. */}
      {showState && state !== null && (
        <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--p-border)' }}>
          <p className="text-sm font-medium">{PLAN_STATE_LINE[state]}</p>
          {state === 'awaiting_you' && mode === null && (
            <p className="text-xs opacity-60">{approvePlanConsequence}</p>
          )}
          {canAct && mode === 'changes' && (
            <div className="flex flex-col gap-2">
              {token && <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="min-h-11 w-full rounded-lg px-3 py-2 text-sm outline-none sm:w-56"
                style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
              />}
              <textarea
                rows={3}
                value={note}
                autoFocus
                onChange={e => setNote(e.target.value)}
                placeholder="What should change? e.g. “Can we shoot the garden set in the morning instead?”"
                className="w-full rounded-lg p-3 text-sm outline-none"
                style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
              />
            </div>
          )}
          {canAct && (
          <div className="flex flex-wrap items-center gap-2">
            {mode === null ? (
              <>
                <button type="button" disabled={busy !== null} onClick={() => act('approve')}
                  className="portal-tap flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
                  <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve the plan'}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => setMode('changes')}
                  className="portal-tap rounded-lg border px-4 py-2.5 text-sm transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: 'var(--p-border)' }}>
                  Request changes
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => act('request_changes')}
                  className="portal-tap rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
                  {busy === 'request_changes' ? 'Sending…' : 'Send'}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => { setMode(null); setNote('') }}
                  className="portal-tap rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: 'var(--p-border)' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
          )}
        </div>
      )}

      {shoot.canvas_cards.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setBoardOpen(v => !v)}
            className="portal-tap flex w-fit items-center gap-2 text-[11px] uppercase tracking-[0.14em] opacity-70 transition-opacity hover:opacity-100"
            style={{ fontFamily: 'var(--p-mono-font, inherit)' }}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${boardOpen ? 'rotate-180' : ''}`} />
            {boardOpen
              ? `Hide ${shoot.board_name || 'the planning board'}`
              : `View ${shoot.board_name || 'the planning board'} · ${shoot.canvas_cards.length} cards`}
          </button>
          {boardOpen && (
            /* the `dark` class pins the canvas to its dark palette so it sits
               naturally in the portal's ink theme — zoom controls included */
            <div className="dark overflow-hidden rounded-xl border" style={{ borderColor: 'var(--p-border)' }}>
              <BriefCanvas
                cards={shoot.canvas_cards}
                references={[]}
                canEdit={false}
                clientName={clientName}
                onOp={async () => false}
              />
            </div>
          )}
        </div>
      )}

      {/* the thread is reachable from the plan itself — it used to appear only
          once the planning board was expanded, so a plan with no board had no
          visible way to reply at all */}
      {token && shoot.details_shared && !bare && (
        <Link href={`/portal/${token}/shoot/${shoot.id}`}
          className="portal-tap flex w-fit items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] underline-offset-4 hover:underline"
          style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
          <MessageCircle className="h-3.5 w-3.5" /> Thoughts on this plan? Leave a comment →
        </Link>
      )}
    </article>
  )
}
