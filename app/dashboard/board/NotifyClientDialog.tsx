'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Bell, Link2, Mail, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { defaultRecipients, type ClientRecipient } from '../../lib/client-recipients-core'

export type NotifyTab = 'editing' | 'designing' | 'shoot' | 'boards' | 'forms'

/**
 * NOTIFY THE CLIENT (the owner, 2 Oct 2026: "for every page a notify client button with the link"). Putting a page on
 * the client's portal emails nobody; this is the press that does: tick who gets it, an optional note, and they get
 * one email with the link to THAT page. Or copy the link to send it another way. The server checks the client can
 * open the page now, and only emails the client's own addresses (app/lib/one-portal-notify.ts).
 */
export function NotifyClientButton({ clientId, tab, id, className }: { clientId: string; tab: NotifyTab; id: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="outline" className={className ?? 'h-11 rounded-full px-4 text-[14px] font-semibold'} onClick={() => setOpen(true)} data-notify-client>
        <Bell className="mr-1.5 h-4 w-4" aria-hidden /> Notify the client
      </Button>
      {open && <NotifyClientDialog clientId={clientId} tab={tab} id={id} onClose={() => setOpen(false)} />}
    </>
  )
}

export default function NotifyClientDialog({ clientId, tab, id, onClose }: { clientId: string; tab: NotifyTab; id: string; onClose: () => void }) {
  const [recipients, setRecipients] = useState<ClientRecipient[] | null>(null)
  const [clientName, setClientName] = useState('')
  const [title, setTitle] = useState('')
  const [link, setLink] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const url = `/api/clients/${encodeURIComponent(clientId)}/notify`

  useEffect(() => {
    let gone = false
    fetch(`${url}?tab=${encodeURIComponent(tab)}&id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (gone) return
        if (!r.ok) { setProblem(String(j?.error ?? 'Could not load the client’s addresses')); setRecipients([]); return }
        const list = (j.recipients ?? []) as ClientRecipient[]
        setRecipients(list); setClientName(String(j.client_name ?? '')); setTitle(String(j.title ?? '')); setLink(String(j.link ?? ''))
        setPicked(new Set(defaultRecipients(list)))
      })
      .catch(() => { if (!gone) { setProblem('Could not load the client’s addresses'); setRecipients([]) } })
    return () => { gone = true }
  }, [url, tab, id])

  const toggle = (email: string) => setPicked(p => { const n = new Set(p); if (n.has(email)) n.delete(email); else n.add(email); return n })

  const send = async () => {
    setSending(true); setProblem(null)
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, id, emails: [...picked], note }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setProblem(String(j?.error ?? 'Could not send it')); return }
      setDone(String(j.message ?? 'Sent.')); toast.success(String(j.message ?? 'Sent.'))
    } catch { setProblem('Could not send it — check the connection and try again') } finally { setSending(false) }
  }
  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link); toast.success('Link copied — paste it to the client') } catch { toast.info('Select the link below and copy it') }
  }
  const blocked = !!problem && !done && recipients !== null && !link

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="ncd-title"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-card bg-popover p-5 shadow-xl sm:rounded-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="ncd-title" className="text-[17px] font-semibold">Notify {clientName || 'the client'}</h2>
            <p className="text-[13px] text-muted-foreground">{title ? `One email with the link to “${title}” on their portal.` : 'One email with the link to this page on their portal.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {problem && <p role="alert" className="rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px]">{problem}</p>}
        {done && <p role="status" className="rounded-inner border border-accent-green/40 bg-tint-green px-3 py-2 text-[13px]">{done}</p>}
        {link && (
          <input readOnly value={link} onFocus={e => e.currentTarget.select()} aria-label="The page's link"
            className="min-h-11 w-full rounded-inner border border-border bg-background px-3 text-[13px]" />
        )}
        {!done && !blocked && (
          <>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Who gets it</legend>
              {recipients === null && <p className="text-[13px] text-muted-foreground">Loading…</p>}
              {recipients !== null && recipients.length === 0 && <p className="text-[13px] text-muted-foreground">No email address on this client yet — add one on the client’s page.</p>}
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
              <Textarea rows={2} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="e.g. Here are this week’s edits — let us know by Thursday." />
            </label>
          </>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="min-h-11 rounded-full" onClick={onClose} disabled={sending}>{done ? 'Close' : 'Cancel'}</Button>
          {link && !done && (
            <Button variant="outline" className="min-h-11 rounded-full" onClick={() => void copy()} disabled={sending}>
              <Link2 className="mr-1.5 h-4 w-4" aria-hidden /> Copy link
            </Button>
          )}
          {!done && !blocked && (
            <Button className="min-h-11 rounded-full" onClick={() => void send()} disabled={sending || picked.size === 0 || !recipients?.length}>
              <Mail className="mr-1.5 h-4 w-4" aria-hidden /> {sending ? 'Sending…' : `Email ${picked.size} ${picked.size === 1 ? 'person' : 'people'}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
