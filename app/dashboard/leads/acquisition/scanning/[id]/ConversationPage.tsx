'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import PageTitle from '../../../../ui/PageTitle'
import Chip from '../../../../ui/Chip'
import { LoadFailed } from '../../../../NotSetUp'
import EmailBody from './EmailBody'
import { leadPath } from '../../../../../lib/lead-page-core'
import { MAILBOX_CANNOT_SEND, REPLY_TEXT_MAX, type Conversation } from '../../../../../lib/acq-conversation-core'

/**
 * ONE SCANNED MESSAGE'S CONVERSATION (the owner, 23 Sep 2026: "just create
 * a page which shows the convo for that", then "is there a way to reply it
 * from here too?"). The whole Gmail thread the scanner's row belongs to,
 * oldest first, read with the scanner's own credentials; the message it
 * read is marked; its verdict and reason sit at the top; a reply box at the
 * bottom sends from the mailbox the thread is in, into the same thread.
 * Nothing is sent unless a person presses Send.
 */
type Answer = Conversation & { can_send: boolean; reply_to: string | null }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

export default function ConversationPage({ id }: { id: string }) {
  const [data, setData] = useState<Answer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/acquisition/scanning/${encodeURIComponent(id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Could not read the thread')
      setData(json); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the thread') }
  }, [id])
  useEffect(() => { void load() }, [load])

  const send = async () => {
    const message = draft.trim()
    if (!message || !data) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/acquisition/scanning/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Could not send')
      toast.success(`Sent from ${json.from} to ${json.to} — it is in the thread`)
      setDraft('')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not send') } finally { setBusy(false) }
  }

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
                <EmailBody html={m.html} text={m.body} />
              </li>
            ))}
          </ol>

          {/* REPLY FROM HERE (23 Sep 2026): from the mailbox the thread is in, into the same thread */}
          <section aria-label="Reply" className="rounded-card border border-border bg-card p-4" data-conversation-reply>
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Reply from {data.mailbox}{data.reply_to ? ` to ${data.reply_to}` : ''}</p>
            {!data.can_send && <p role="status" className="mt-2 text-[13px] text-muted-foreground">{MAILBOX_CANNOT_SEND(data.mailbox)}</p>}
            <textarea value={draft} onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight + 2, 600)}px` }} rows={5} maxLength={REPLY_TEXT_MAX} disabled={busy || !data.can_send || !data.reply_to}
              placeholder={data.can_send ? 'Your words. It goes as a normal email from this mailbox, in this thread.' : 'Connect this mailbox for replies first'}
              className="mt-3 w-full resize-y rounded-inner border border-border bg-surface p-3 text-[14px] disabled:opacity-60" aria-label="Your reply" />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button disabled={busy || !draft.trim() || !data.can_send || !data.reply_to} onClick={() => void send()} className="h-10 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
                <Send className="mr-1.5 h-4 w-4" aria-hidden /> {busy ? 'Sending…' : 'Send'}
              </Button>
              <span className="text-[12px] text-muted-foreground">Nothing is ever sent for you — only what you press Send on.</span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
