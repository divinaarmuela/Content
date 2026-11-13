'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Chip from './ui/Chip'
import Pager from './ui/Pager'
import { pageSlice } from '../lib/pager-core'
import type { ClientCommentRow } from '../lib/client-comments-core'

const SIZE = 3
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

/**
 * WHAT CLIENTS SAID LATELY, ON THE OVERVIEW (the owner, 13 Nov 2026: "let's add clients' recent comments and when
 * click it opens"). The same list as Post approval's Comments view (/api/social/client-comments), three at a time
 * with left and right, each row opening its post. The route decides who may read it (account managers, quality
 * checkers, super admins); anyone else gets no panel at all.
 */
export default function RecentClientComments() {
  const [rows, setRows] = useState<ClientCommentRow[] | null>(null)
  const [hidden, setHidden] = useState(false)
  const [page, setPage] = useState(0)
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/client-comments', { cache: 'no-store' })
      if (res.status === 401 || res.status === 403) { setHidden(true); return }
      if (!res.ok) return
      const json = await res.json()
      setRows(Array.isArray(json.rows) ? json.rows : [])
    } catch { /* a failed read keeps what is on screen */ }
  }, [])
  useEffect(() => { void load(); const t = setInterval(load, 120_000); return () => clearInterval(t) }, [load])

  if (hidden) return null
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface p-5 sm:p-6" data-recent-client-comments>
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-section-title">Clients&rsquo; recent comments</h2>
        <Link href="/dashboard/scheduler?view=comments" className="-my-3 inline-flex min-h-11 shrink-0 items-center text-[13px] font-semibold underline-offset-4 hover:underline">View all</Link>
      </div>
      {rows === null
        ? <p className="text-[13px] text-muted-foreground" role="status">Loading…</p>
        : rows.length === 0
          ? <p className="text-[13px] text-muted-foreground">No client comments yet.</p>
          : (
            <>
              <ul className="flex flex-col gap-2.5">
                {pageSlice(rows, page, SIZE).map(r => (
                  <li key={r.id}>
                    <Link href={`/dashboard/scheduler?post=${encodeURIComponent(r.post_id)}`}
                      className="flex flex-col gap-1.5 rounded-[14px] border border-border p-3 transition-colors hover:border-foreground/30">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[14px] font-semibold text-foreground">{r.client}</span>
                        {r.answer === 'not_approved' && <Chip tone="red">Not approved</Chip>}
                        {r.answer === 'approved' && <Chip tone="green">Approved</Chip>}
                      </span>
                      <span className="line-clamp-3 break-words text-[13px] text-foreground">&ldquo;{r.body}&rdquo;</span>
                      <span className="truncate text-[12px] text-muted-foreground">{r.title} · {when(r.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Pager page={page} total={rows.length} size={SIZE} onPage={setPage} what="comments" />
            </>
          )}
    </section>
  )
}
