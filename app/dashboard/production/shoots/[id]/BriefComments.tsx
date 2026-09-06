'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle2, CircleDashed, Send } from 'lucide-react'
import { useProductionLive, type ProductionChange } from '../../useProductionLive'
import MentionBox from '../../../MentionBox'
import { extractMentions, type Mentionable } from '../../../../lib/mention-core'
import type { CanvasCard } from '../../../../lib/batch-brief-core'
import { canvasCardLabel, findCanvasCard, onCardLine } from '../../../../lib/canvas-comments-core'
import { OPEN_CARD_EVENT } from './BriefBoardComments'

type Row = {
  id: string
  created_at: string
  body: string
  author_id?: string | null
  assigned_to?: string | null
  resolved?: boolean
  /** pinned to one card of the planning board */
  card_id?: string | null
  team_users: { name: string | null; role: string | null } | null
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The shoot's comment thread — the SAME thread the client sees on their
 * portal shoot page. A client row is signed with their name; team replies
 * appear on the portal as MD Media.
 *
 * "@Name" tags a colleague: they get the email and the note sits under
 * "Waiting on you" until someone ticks it done. The client sees the words,
 * never the tag.
 */
export default function BriefComments({ batchId, cards = [] }: {
  batchId: string
  /** the planning board, so a comment pinned to a card can say which */
  cards?: CanvasCard[]
}) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [viewerId, setViewerId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [team, setTeam] = useState<Mentionable[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`)
    if (res.ok) {
      const json = await res.json()
      setRows(json.comments ?? [])
      setViewerId(json.viewer_id ?? null)
    } else setRows([])
  }, [batchId])
  useEffect(() => { void load() }, [load])

  // the people "@" can reach — any active team member; /api/team answers
  // every team role
  useEffect(() => {
    fetch('/api/team')
      .then(r => (r.ok ? r.json() : { members: [] }))
      .then((json: { members?: { id: string; name: string; email: string; role: string; active_status?: boolean }[] }) =>
        setTeam((json.members ?? [])
          .filter(m => m.role !== 'client' && m.active_status !== false)
          .map(m => ({ id: m.id, name: m.name || m.email }))))
      .catch(() => setTeam([]))
  }, [])

  // both the team-side POST and the client's portal POST announce a change
  // tagged `batch:${batchId}` — refetch only when this thread is the one that moved
  const onLive = useCallback((change?: ProductionChange) => {
    if (!change || change.item_id === `batch:${batchId}`) void load()
  }, [batchId, load])
  useProductionLive(onLive)

  const mentionable = team.filter(m => m.id !== viewerId)
  const nameOf = (id: string | null | undefined) => team.find(m => m.id === id)?.name ?? null

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    const tagged = extractMentions(draft, mentionable)
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: draft, ...(tagged.length ? { mention_ids: tagged.map(t => t.id) } : {}) }),
    })
    setSending(false)
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? 'Could not send')
      return
    }
    setDraft('')
    toast.success(tagged.length > 0
      ? `Posted — ${tagged.map(t => t.name).join(', ')} ${tagged.length === 1 ? 'has' : 'have'} been emailed`
      : 'Posted — the client can read it on their portal')
    void load()
  }

  const toggle = async (r: Row) => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment_id: r.id, resolved: !r.resolved }),
    })
    if (!res.ok) { toast.error((await res.json().catch(() => null))?.error ?? 'Could not update'); return }
    toast.success(r.resolved ? 'Reopened' : 'Marked done — it is off their list')
    void load()
  }

  return (
    <Card id="comments">
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-body-15 font-semibold">
          Comments {rows && rows.length > 0 && <span className="ml-1 font-normal text-muted-foreground">· {rows.length}</span>}
        </p>
        <p className="text-secondary-13 text-muted-foreground">
          Shared with the client — they read and write this on their portal. Type @ and a name to tag a colleague; the client sees the words, not the tag.
        </p>
        <div className="flex flex-col gap-3">
          {rows?.length === 0 && <p className="text-body-15 text-muted-foreground">No comments yet.</p>}
          {(rows ?? []).map(r => {
            const fromClient = r.team_users?.role === 'client'
            const name = fromClient
              ? (r.team_users?.name ?? 'Client').replace(/ \(client portal\)$/, '')
              : r.team_users?.name ?? 'Team'
            const forMe = !!r.assigned_to && r.assigned_to === viewerId
            return (
              <div key={r.id} className={`flex items-start gap-2 border-b border-border pb-2.5 last:border-0 ${
                forMe && !r.resolved ? 'rounded-tile bg-tint-amber px-2 pt-2' : ''
              }`}>
                {r.assigned_to && (
                  <button type="button" onClick={() => void toggle(r)}
                    aria-label={r.resolved ? 'Reopen' : 'Mark done'} title={r.resolved ? 'Reopen' : 'Mark done'}
                    className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center">
                    {r.resolved
                      ? <CheckCircle2 className="h-4 w-4 text-accent-green" />
                      : <CircleDashed className="h-4 w-4 text-muted-foreground" />}
                  </button>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="flex flex-wrap items-baseline gap-2 text-secondary-13">
                    <span className="font-medium">{name}</span>
                    {fromClient && (
                      <span className="rounded bg-tint-blue px-1 py-px text-[9px] uppercase tracking-wider text-accent-blue-deep">
                        client
                      </span>
                    )}
                    <span className="text-muted-foreground">{when(r.created_at)}</span>
                    {r.card_id && (
                      // opens that card's thread beside the board (BriefBoardComments listens)
                      <button type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_CARD_EVENT, { detail: r.card_id }))}
                        className="rounded bg-tint-amber px-1.5 py-px text-[11px] italic text-foreground underline-offset-2 hover:underline">
                        {onCardLine(canvasCardLabel(findCanvasCard(cards, r.card_id)))}
                      </button>
                    )}
                    {r.assigned_to && !r.resolved && (
                      <span className="rounded-full bg-tint-amber px-2.5 py-1.5 text-chip-12 font-medium text-foreground">
                        {forMe ? 'Waiting on you' : `Waiting on ${nameOf(r.assigned_to) ?? 'someone'}`}
                      </span>
                    )}
                  </p>
                  <p className={`whitespace-pre-wrap break-words text-body-15 ${r.resolved ? 'text-muted-foreground line-through' : ''}`}>{r.body}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-2">
          <MentionBox
            value={draft}
            onChange={setDraft}
            members={mentionable}
            placeholder="Reply to the client, or type @ to tag a colleague…"
            onSubmit={() => void send()}
            disabled={sending}
          />
          <Button size="sm" className="min-h-11 w-fit md:min-h-8" disabled={sending || !draft.trim()} onClick={() => void send()}>
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
