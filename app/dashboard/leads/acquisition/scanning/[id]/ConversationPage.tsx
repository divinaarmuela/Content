'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import PageTitle from '../../../../ui/PageTitle'
import Chip from '../../../../ui/Chip'
import { LoadFailed } from '../../../../NotSetUp'
import { leadPath } from '../../../../../lib/lead-page-core'
import type { Conversation } from '../../../../../lib/acq-conversation-core'

/**
 * ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "just create
 * a page which shows the convo for that"). The whole Gmail thread the
 * scanner's row belongs to, oldest first, read with the scanner's own
 * credentials; the message it read is marked; its verdict and reason sit
 * at the top. Nothing here writes.
 */
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export default function ConversationPage({ id }: { id: string }) {
  const [data, setData] = useState<Conversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/leads/acquisition/scanning/${encodeURIComponent(id)}`, { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? 'Could not read the thread')
        if (live) setData(json)
      } catch (e) { if (live) setError(e instanceof Error ? e.message : 'Could not read the thread') }
    })()
    return () => { live = false }
  }, [id])

  return (
    <div className="flex flex-col gap-4" data-scan-conversation>
      <Link href="/dashboard/leads/acquisition/scanning" className="inline-flex min-h-11 w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden /> Scanning</Link>
      <PageTitle title={data?.subject ?? 'Conversation'} summary={data ? `In ${data.mailbox} · ${data.messages.length} ${data.messages.length === 1 ? 'message' : 'messages'}` : 'Reading the thread from the mailbox…'} />
      {error && <LoadFailed what="this conversation" detail={error} onRetry={() => window.location.reload()} />}
      {data && (
        <>
          <section aria-label="What the scanner decided" className="rounded-card border border-border bg-card px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">The scanner decided</span>
              <Chip tone={data.decision.startsWith('Made a lead') || data.decision.startsWith('Added to') ? 'green' : 'muted'}>{data.decision}</Chip>
              {data.lead_id && <Link href={leadPath(data.lead_id)} className="font-semibold underline-offset-4 hover:underline">Open the lead</Link>}
            </div>
            {data.reasoning && <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">{data.reasoning}</p>}
          </section>
          <ol className="flex flex-col gap-3" aria-label="Messages">
            {data.messages.map(m => (
              <li key={m.id} className={`rounded-card border p-4 ${m.direction === 'out' ? 'border-accent-blue/40 bg-tint-blue' : 'border-border bg-card'} ${m.scanned ? 'ring-1 ring-foreground/20' : ''}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px]">
                  <span className="font-semibold">{m.who}</span>
                  <span className="text-muted-foreground">{m.email}</span>
                  <Chip tone={m.direction === 'out' ? 'blue' : 'surface'}>{m.direction === 'out' ? 'From MD Media' : 'To MD Media'}</Chip>
                  {m.scanned && <Chip tone="muted">The one the scanner read</Chip>}
                  <span className="ml-auto text-muted-foreground">{when(m.at)}</span>
                </div>
                {m.to && <p className="mt-0.5 text-[12px] text-muted-foreground">To {m.to}</p>}
                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed">{m.body}</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
