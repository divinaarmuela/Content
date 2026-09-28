'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, MessageSquare } from 'lucide-react'

const NAME_KEY = 'mdm-portal-name'

/**
 * THE CLIENT'S ANSWER, ON ITS OWN (the owner, 28 Sep 2026: "the portal is for the approved post, not the boards").
 * One big Approve; "Ask for a change" opens a box for what to change. The same /api/portal/act the board uses, so
 * the server's rules (only a card With client, only this client's) decide — this only asks.
 */
export default function ApprovePanel({ token, itemId, state, clientName, kind = 'card', preview = false }: {
  /** card = the edit (approve / request_changes); post = the final post (approve_post / request_post_changes) */
  kind?: 'card' | 'post'
  /** the team's preview: shown exactly, answered never */
  preview?: boolean
  token: string
  itemId: string
  /** waiting = theirs to answer now; approved / changes = already answered; not_ready = not with them yet */
  state: 'waiting' | 'approved' | 'changes' | 'not_ready'
  clientName: string
}) {
  const router = useRouter()
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'approve' | 'request_changes' | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [answered, setAnswered] = useState<'approved' | 'changes' | null>(null)

  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? '') } catch { /* private mode */ } }, [])

  const act = async (action: 'approve' | 'request_changes') => {
    if (preview) { setProblem('Preview — Approve and Ask for a change are switched off here'); return }
    const text = action === 'request_changes' ? note.trim() : ''
    if (action === 'request_changes' && !text) { setProblem('Tell us what to change — a few words is enough'); return }
    const who = name.trim().slice(0, 60)
    if (who) { try { localStorage.setItem(NAME_KEY, who) } catch { /* fine */ } }
    setBusy(action); setProblem(null)
    try {
      const res = await fetch('/api/portal/act', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, item_id: itemId, action: kind === 'post' ? (action === 'approve' ? 'approve_post' : 'request_post_changes') : action, comment: text, author_name: who }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(j?.error ?? 'That did not go through — try again in a moment'))
      setAnswered(action === 'approve' ? 'approved' : 'changes')
      router.refresh()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'That did not go through — try again in a moment')
    } finally {
      setBusy(null)
    }
  }

  const shown = answered ?? (state === 'approved' ? 'approved' : state === 'changes' ? 'changes' : null)
  if (shown) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-card border border-border bg-card p-5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${shown === 'approved' ? 'bg-accent-green text-white' : 'bg-foreground text-background'}`}>
          {shown === 'approved' ? <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden /> : <MessageSquare className="h-5 w-5" aria-hidden />}
        </span>
        <div>
          <p className="text-[17px] font-semibold">{shown === 'approved' ? 'Approved — thank you' : 'Thanks — we have your note'}</p>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            {shown === 'approved' ? 'We’ll book it in to go out. Nothing else to do.' : 'We’ll make the change and send it back to you.'}
          </p>
        </div>
      </div>
    )
  }
  if (state === 'not_ready') {
    return (
      <p className="rounded-card border border-border bg-card p-5 text-[15px] text-muted-foreground">
        This isn’t waiting on you right now — we’ll send it over when it is.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-5">
      <div>
        <p className="text-[17px] font-semibold">Happy with this?</p>
        <p className="mt-0.5 text-[14px] text-muted-foreground">Approve it and we’ll book it in, or tell us what to change.</p>
      </div>
      <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
        Your name (optional)
        <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder={clientName}
          className="min-h-11 rounded-inner border border-border bg-background px-3 text-[15px] text-foreground" />
      </label>
      {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[14px]">{problem}</p>}
      {!asking ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={busy !== null} onClick={() => void act('approve')}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-6 text-[16px] font-semibold text-background disabled:opacity-60">
            <Check className="h-5 w-5" strokeWidth={2.6} aria-hidden /> {busy === 'approve' ? 'Approving…' : 'Approve'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => { setAsking(true); setProblem(null) }}
            className="min-h-12 rounded-full border border-border px-6 text-[15px] font-semibold hover:bg-muted disabled:opacity-60">
            Ask for a change
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-muted-foreground">
            What should we change?
            <textarea autoFocus rows={4} value={note} maxLength={2000} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Swap the second picture, and make the caption shorter."
              className="rounded-inner border border-border bg-background px-3 py-2 text-[15px] text-foreground" />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={busy !== null} onClick={() => void act('request_changes')}
              className="min-h-12 flex-1 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background disabled:opacity-60">
              {busy === 'request_changes' ? 'Sending…' : 'Send my note'}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => { setAsking(false); setProblem(null) }}
              className="min-h-12 rounded-full border border-border px-6 text-[15px] font-semibold hover:bg-muted">
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
