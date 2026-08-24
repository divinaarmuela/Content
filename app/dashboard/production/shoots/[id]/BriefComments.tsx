'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Send } from 'lucide-react'
import { useProductionLive, type ProductionChange } from '../../useProductionLive'

type Row = {
  id: string
  created_at: string
  body: string
  team_users: { name: string | null; role: string | null } | null
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * The shoot's comment thread — the SAME thread the client sees on their
 * portal shoot page. A client row is signed with their name; team replies
 * appear on the portal as MD Media.
 */
export default function BriefComments({ batchId }: { batchId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/production/batches/${batchId}/comments`)
    if (res.ok) setRows((await res.json()).comments ?? [])
    else setRows([])
  }, [batchId])
  useEffect(() => { void load() }, [load])

  // both the team-side POST and the client's portal POST announce a change
  // tagged `batch:${batchId}` — refetch only when this thread is the one that moved
  const onLive = useCallback((change?: ProductionChange) => {
    if (!change || change.item_id === `batch:${batchId}`) void load()
  }, [batchId, load])
  useProductionLive(onLive)

  const send = async () => {
    if (!draft.trim() || sending) return
    setSending(true)
    const res = await fetch(`/api/production/batches/${batchId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: draft }),
    })
    setSending(false)
    if (!res.ok) {
      toast.error((await res.json().catch(() => null))?.error ?? 'Could not send')
      return
    }
    setDraft('')
    void load()
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          Comments {rows && rows.length > 0 && <span className="ml-1">· {rows.length}</span>}
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Shared with the client — they read and write this thread on their portal shoot page.
        </p>
        <div className="flex flex-col gap-3">
          {rows?.length === 0 && <p className="text-sm text-zinc-400 dark:text-zinc-500">No comments yet.</p>}
          {(rows ?? []).map(r => {
            const fromClient = r.team_users?.role === 'client'
            const name = fromClient
              ? (r.team_users?.name ?? 'Client').replace(/ \(client portal\)$/, '')
              : r.team_users?.name ?? 'Team'
            return (
              <div key={r.id} className="flex flex-col gap-0.5 border-b border-zinc-100 pb-2.5 last:border-0 dark:border-zinc-800">
                <p className="flex items-baseline gap-2 text-xs">
                  <span className="font-medium">{name}</span>
                  {fromClient && (
                    <span className="rounded bg-violet-100 px-1 py-px text-[9px] uppercase tracking-wider text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                      client
                    </span>
                  )}
                  <span className="text-zinc-400 dark:text-zinc-500">{when(r.created_at)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm">{r.body}</p>
              </div>
            )
          })}
        </div>
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send() }}
            placeholder="Reply to the client — they'll see it on their portal…"
            rows={2}
            className="w-full resize-none rounded-md border border-zinc-200 bg-transparent p-2.5 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:focus:border-zinc-600"
          />
          <Button size="sm" className="w-fit" disabled={sending || !draft.trim()} onClick={() => void send()}>
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
