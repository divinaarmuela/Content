'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Calendar, Check, ChevronDown, FileDown, MapPin, MessageCircle } from 'lucide-react'
import BriefCanvas from '../../dashboard/production/shoots/[id]/BriefCanvas'
import { SectionHeading } from './PortalSections'
import type { PortalShoot } from '../../lib/portal-data'

const dateLabel = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Date to be confirmed'

/**
 * SHOOT PLANS — the shoots an account manager chose to share. Summary,
 * deliverables, shot list, and a read-only pan/zoom view of the planning
 * board. The board keeps its own light look inside the portal, framed like
 * a piece of work rather than restyled.
 */
export default function ShootSection({ shoots, clientName, token }: { shoots: PortalShoot[]; clientName?: string; token?: string }) {
  if (shoots.length === 0) return null
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading count={shoots.length}>SHOOT PLANS</SectionHeading>
      <div className="flex flex-col gap-10">
        {shoots.map(s => <ShootCard key={s.id} shoot={s} clientName={clientName} token={token} />)}
      </div>
    </section>
  )
}

function ShootCard({ shoot, clientName, token }: { shoot: PortalShoot; clientName?: string; token?: string }) {
  const router = useRouter()
  const [boardOpen, setBoardOpen] = useState(false)
  const done = shoot.shot_list.filter(r => r.done).length

  // the plan is with the client for a decision — the state machine says it is
  // their turn, so the two moves have to be here, on the plan
  const decide = shoot.awaiting_decision
  const [mode, setMode] = useState<null | 'changes'>(null)
  const [note, setNote] = useState('')
  const [name, setName] = useState(() =>
    typeof window === 'undefined' ? '' : localStorage.getItem('mdm-portal-name') ?? '')
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (action: 'approve' | 'request_changes') => {
    if (!token || !decide) return
    if (action === 'request_changes') {
      if (!note.trim()) return toast.error('Write what should change first')
      if (!name.trim()) return toast.error('Add your name so the team knows who asked')
    }
    if (name.trim()) localStorage.setItem('mdm-portal-name', name.trim())
    setBusy(action)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, item_id: decide.item_id, action, comment: note, author_name: name.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Something went wrong')
      toast.success(action === 'approve' ? 'Plan approved — thank you!' : 'Sent to your account manager')
      setNote('')
      setMode(null)
      router.refresh()
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
            className="text-lg font-medium tracking-tight underline-offset-4 hover:underline"
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
        <span className="ml-auto flex items-center gap-4 text-xs opacity-70" style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
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
          className="flex w-fit items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] opacity-70 transition-opacity hover:opacity-100"
          style={{ fontFamily: 'var(--p-mono-font, inherit)' }}
        >
          <FileDown className="h-3.5 w-3.5" /> Download brief PDF
        </a>
      )}

      {shoot.planned_deliverables.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {shoot.planned_deliverables.map(d => (
            <span key={d.type} className="border px-2 py-1 text-[11px] uppercase tracking-wider"
              style={{ borderColor: 'var(--p-border)', fontFamily: 'var(--p-mono-font, inherit)' }}>
              {d.qty} {d.type}{d.qty > 1 ? 's' : ''}
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

      {token && decide && (
        <div className="flex flex-col gap-3 border-t pt-4" style={{ borderColor: 'var(--p-border)' }}>
          <p className="text-sm font-medium">
            This plan is with you. Approve it and we&rsquo;ll lock the date, or tell us what to change.
          </p>
          {mode === 'changes' && (
            <div className="flex flex-col gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg px-3 py-2 text-sm outline-none sm:w-56"
                style={{ background: 'var(--p-bg, #fafafa)', border: '1px solid var(--p-border, #e4e4e7)', color: 'var(--p-ink, #18181b)' }}
              />
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
          <div className="flex flex-wrap items-center gap-2">
            {mode === null ? (
              <>
                <button type="button" disabled={busy !== null} onClick={() => act('approve')}
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
                  <Check className="h-4 w-4" /> {busy === 'approve' ? 'Approving…' : 'Approve the plan'}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => setMode('changes')}
                  className="rounded-lg border px-4 py-2 text-sm transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ borderColor: 'var(--p-border)' }}>
                  Request changes
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy !== null} onClick={() => act('request_changes')}
                  className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--p-accent, #18181b)', color: 'var(--p-accent-ink, #ffffff)' }}>
                  {busy === 'request_changes' ? 'Sending…' : 'Send this to the team'}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => { setMode(null); setNote('') }}
                  className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: 'var(--p-border)' }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {shoot.canvas_cards.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setBoardOpen(v => !v)}
            className="flex w-fit items-center gap-2 text-[11px] uppercase tracking-[0.14em] opacity-70 transition-opacity hover:opacity-100"
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
          {boardOpen && token && (
            <Link href={`/portal/${token}/shoot/${shoot.id}`}
              className="flex w-fit items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] underline-offset-4 hover:underline"
              style={{ fontFamily: 'var(--p-mono-font, inherit)' }}>
              <MessageCircle className="h-3.5 w-3.5" /> Thoughts on this plan? Leave a comment →
            </Link>
          )}
        </div>
      )}
    </article>
  )
}
