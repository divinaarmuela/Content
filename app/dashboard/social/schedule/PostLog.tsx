'use client'

import { useEffect, useState } from 'react'
import { Mail } from 'lucide-react'

/**
 * THE POST'S LOG (the owner, 2 Nov 2026: "can we add a log section in the card … so everyone can see"): each move
 * — what happened, who did it, when, the words they left — and under it who was told and whether the email went.
 * Read from /api/posts/<id>/log when the tab is opened; nothing is fetched while it stays shut.
 */

type Sent = { to: string; email: string | null; subject: string; status: string | null; at: string | null }
type Row = { rev: number; at: string; what: string; by: string; note: string | null; sent: Sent[] }

const when = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '')

function SentLine({ s }: { s: Sent }) {
  const failed = s.status && !['sent', 'delivered'].includes(s.status)
  return (
    <li className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold text-foreground">{s.to}</span> — “{s.subject}”
        {failed ? <span className="ml-1 font-semibold text-accent-red-deep">({s.status})</span> : null}
        {s.at ? <span className="ml-1">· {when(s.at)}</span> : null}
      </span>
    </li>
  )
}

export default function PostLog({ postId }: { postId: string }) {
  const [log, setLog] = useState<{ rows: Row[]; other: Sent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setLog(null); setError(null)
    fetch(`/api/posts/${encodeURIComponent(postId)}/log`, { cache: 'no-store' })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!live) return; if (!r.ok) setError(j.error ?? 'The log could not be read'); else setLog(j) })
      .catch(() => { if (live) setError('The log could not be read') })
    return () => { live = false }
  }, [postId])

  if (error) return <p className="text-[13px] text-muted-foreground">{error}</p>
  if (!log) return <p className="text-[13px] text-muted-foreground">Reading the log…</p>
  if (!log.rows.length && !log.other.length) return <p className="text-[13px] text-muted-foreground">Nothing has happened to this post yet.</p>
  return (
    <div className="flex flex-col gap-3" data-post-log>
      <ol className="flex flex-col gap-2.5">
        {[...log.rows].reverse().map(r => (
          <li key={r.rev} className="rounded-inner border border-border bg-surface px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-semibold">{r.what}</span>
              <span className="text-muted-foreground">by {r.by}</span>
              <span className="ml-auto text-[12px] text-muted-foreground">{when(r.at)}</span>
            </div>
            {r.note && <p className="mt-1 whitespace-pre-wrap text-[13px]">{r.note}</p>}
            {r.sent.length > 0
              ? <ul className="mt-1.5 flex flex-col gap-0.5">{r.sent.map((s, i) => <SentLine key={i} s={s} />)}</ul>
              : null}
          </li>
        ))}
      </ol>
      {log.other.length > 0 && (
        <div className="rounded-inner border border-border bg-muted/40 px-3 py-2">
          <p className="mb-1 text-[12px] font-semibold">Other emails about this post and its card</p>
          <ul className="flex flex-col gap-0.5">{log.other.map((s, i) => <SentLine key={i} s={s} />)}</ul>
        </div>
      )}
    </div>
  )
}
