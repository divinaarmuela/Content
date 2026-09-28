'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Mail, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ClientRecipient } from '../../lib/post-to-client-core'

/**
 * SEND TO CLIENT — confirm who gets it, then send (the owner, 28 Sep 2026: "at With client it should be sent to the
 * client, confirming the emails that will receive it"). Lists the client's own address and its people, the main
 * ones ticked; a short note is optional. The server re-checks everything: the card is With client, the sender is an
 * account manager or a super admin, and every address is on the client's own list.
 */
export default function SendToClientDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [recipients, setRecipients] = useState<ClientRecipient[] | null>(null)
  const [clientName, setClientName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    let gone = false
    fetch(`/api/production/items/${itemId}/send-to-client`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (gone) return
        if (!r.ok) { setProblem(String(j?.error ?? 'Could not load the client’s addresses')); setRecipients([]); return }
        const list = (j.recipients ?? []) as ClientRecipient[]
        setRecipients(list)
        setClientName(String(j.client_name ?? ''))
        // the main addresses ticked; if none is marked main, the first one
        const main = list.filter(x => x.primary)
        setPicked(new Set((main.length ? main : list.slice(0, 1)).map(x => x.email)))
        if (!j.has_portal) setProblem('This client has no portal link yet — make one on the client first')
        else if (!j.sendable) setProblem('This can be sent once it is With client')
      })
      .catch(() => { if (!gone) { setProblem('Could not load the client’s addresses'); setRecipients([]) } })
    return () => { gone = true }
  }, [itemId])

  const toggle = (email: string) => setPicked(p => {
    const n = new Set(p)
    if (n.has(email)) n.delete(email); else n.add(email)
    return n
  })

  const send = async (test = false) => {
    setSending(true); setProblem(null)
    try {
      const res = await fetch(`/api/production/items/${itemId}/send-to-client`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [...picked], note, ...(test ? { test: true } : {}) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(String(j?.message ?? j?.error ?? 'Could not send it')); return }
      // a test leaves the window open, so the real send is one press away
      if (test) { toast.success(String(j.message ?? 'Test sent.')); return }
      setDone(String(j.message ?? 'Sent.'))
      toast.success(String(j.message ?? 'Sent.'))
    } catch {
      setProblem('Could not send it — check the connection and try again')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="stc-title"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-card bg-popover p-5 shadow-xl sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="stc-title" className="text-[17px] font-semibold">Send to {clientName || 'the client'}</h2>
            <p className="text-[13px] text-muted-foreground">They get an email with a link to view it and press Approve. Their yes moves it to Ready to post.</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* the answer first, where it is seen (28 Sep 2026) */}
        {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px]">{problem}</p>}
        {done && <p role="status" className="rounded-inner border border-accent-green/40 bg-tint-green px-3 py-2 text-[13px]">{done}</p>}

        {!done && (
          <>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Who gets it</legend>
              {recipients === null && <p className="text-[13px] text-muted-foreground">Loading…</p>}
              {recipients !== null && recipients.length === 0 && (
                <p className="text-[13px] text-muted-foreground">No email address on this client yet — add one on the client’s page.</p>
              )}
              {(recipients ?? []).map(r => (
                <label key={r.email} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-inner border border-border px-3 py-2 hover:bg-muted">
                  <input type="checkbox" className="h-4 w-4" checked={picked.has(r.email)} onChange={() => toggle(r.email)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{r.name}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{r.email} · {r.label}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-[13px] font-semibold">
              A note with it (optional)
              <Textarea rows={2} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="e.g. Here’s this week’s carousel — let us know by Thursday." />
            </label>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" className="min-h-11 rounded-full" onClick={onClose} disabled={sending}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && (
            <Button variant="outline" className="min-h-11 rounded-full" onClick={() => void send(true)}
              disabled={sending || (!!problem && problem.startsWith('This'))}
              title="Emails you the exact email the client gets, with the page in preview">
              Send me a test first
            </Button>
          )}
          {!done && (
            <Button className="min-h-11 rounded-full" onClick={() => void send()}
              disabled={sending || picked.size === 0 || !recipients?.length || (!!problem && problem.startsWith('This'))}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden />
              {sending ? 'Sending…' : `Send to ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
