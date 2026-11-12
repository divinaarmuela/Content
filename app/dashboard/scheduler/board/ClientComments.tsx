'use client'

import { useCallback, useEffect, useState } from 'react'
import Chip from '../../ui/Chip'
import type { ClientCommentRow } from '../../../lib/client-comments-core'

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
const STAGE_WORD: Record<string, string> = { draft: 'Draft', quality_check: 'Quality check', with_client: 'With client', ready: 'Ready to post', booked: 'Booked in', posted: 'Posted', cancelled: 'Cancelled' }

/**
 * THE COMMENTS VIEW (12 Nov 2026, the owner): what clients have said on their posts lately, newest first — one
 * place for an account manager, a quality checker or a super admin to read it, each row opening its post.
 */
export default function ClientComments({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<ClientCommentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/client-comments', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load the comments')
      setRows(json.rows); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the comments') }
  }, [])
  useEffect(() => { void load(); const t = setInterval(load, 120_000); return () => clearInterval(t) }, [load])

  const shown = (rows ?? []).filter(r => !clientId || r.client_id === clientId)
  if (error) return <p role="alert" className="rounded-inner border border-border px-4 py-3 text-[13px] font-medium">{error}</p>
  if (rows === null) return <p className="text-[13px] text-muted-foreground" role="status">Loading the clients&rsquo; comments…</p>
  if (shown.length === 0) return <p className="rounded-inner border border-dashed border-border px-4 py-10 text-center text-[13px] text-muted-foreground">No client comments yet. When a client comments on a post in their portal, it shows here.</p>
  return (
    <ul className="flex flex-col gap-2.5" data-client-comments>
      {shown.map(r => (
        <li key={r.id}>
          <a href={`/dashboard/scheduler?post=${encodeURIComponent(r.post_id)}`}
            className="flex flex-col gap-1.5 rounded-inner border border-border bg-surface p-3 hover:border-foreground/30">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-foreground">{r.client}</span>
              <span className="min-w-0 truncate text-[13px] text-muted-foreground">{r.title}</span>
              {r.answer === 'not_approved' && <Chip tone="red">Not approved</Chip>}
              {r.answer === 'approved' && <Chip tone="green">Approved, with a comment</Chip>}
              {r.stage && <Chip tone="muted">{STAGE_WORD[r.stage] ?? r.stage}</Chip>}
              {r.earlier_version && <Chip tone="muted">On an earlier version</Chip>}
            </span>
            <span className="whitespace-pre-wrap break-words text-[14px] text-foreground">&ldquo;{r.body}&rdquo;</span>
            <span className="text-[12px] text-muted-foreground">
              {r.author} · {when(r.at)}{r.scheduled_for ? ` · post ${r.stage === 'booked' ? 'goes out' : 'was due'} ${when(r.scheduled_for)}` : ''}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}
