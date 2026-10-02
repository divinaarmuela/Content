'use client'

import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * SEND THE PREVIEW (docs/ONE_PORTAL_SPEC.md R12) — on the Schedule page's toolbar, for a client on the one
 * portal only: the email that tells the client to look at their Scheduling tab. The dialog shows who gets it
 * (all ticked; untick anyone), the posts it is about, the link itself, and a note. Nothing is drawn for a client
 * not on the one portal (the route answers 409).
 */

type Info = {
  link: string | null
  recipients: { email: string; name: string }[]
  booked: number
  unanswered: { id: string; scheduled_for: string | null }[]
}

export default function SendPreview({ clientId, className }: { clientId: string | null; className?: string }) {
  const [info, setInfo] = useState<Info | null>(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    if (!clientId) { setInfo(null); return }
    const res = await fetch(`/api/clients/${clientId}/send-preview`).catch(() => null)
    if (!res || !res.ok) { setInfo(null); return }
    const json = await res.json() as Info
    setInfo(json)
    setPicked(json.recipients.map(r => r.email))
  }
  useEffect(() => { void load() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!clientId || !info) return null

  const send = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/send-preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: picked, note: note.trim() || null }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'The preview could not be sent')
      toast.success(json.message ?? 'Preview sent')
      setOpen(false)
      setNote('')
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The preview could not be sent')
    } finally {
      setBusy(false)
    }
  }

  const n = info.unanswered.length
  return (
    <>
      <button type="button" onClick={() => { void load(); setOpen(true) }}
        className={`min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[13px] font-semibold hover:bg-muted ${className ?? 'flex'}`}
        data-send-preview>
        <Send className="h-4 w-4" strokeWidth={1.8} aria-hidden />
        Send the preview{n > 0 ? ` · ${n}` : ''}
      </button>
      <Dialog open={open} onOpenChange={o => { if (!busy) setOpen(o) }}>
        <DialogContent className="bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send the preview</DialogTitle>
            <DialogDescription>
              An email to the client with one link to their Scheduling tab, where every booked post shows as it will look.
              {n > 0 ? ` ${n === 1 ? '1 booked post has' : `${n} booked posts have`} not been looked at yet.` : ' Every booked post has an answer — they can still look.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {info.recipients.length === 0 ? (
              <p className="text-[14px]" role="alert">This client has nobody to send to — add a contact on the client&apos;s page first.</p>
            ) : (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[13px] font-semibold">Who gets it</legend>
                {info.recipients.map(r => (
                  <label key={r.email} className="flex min-h-10 items-center gap-2 text-[14px]">
                    <input type="checkbox" className="h-4 w-4" checked={picked.includes(r.email)}
                      onChange={e => setPicked(p => e.target.checked ? [...p, r.email] : p.filter(x => x !== r.email))} />
                    <span>{r.name !== r.email ? `${r.name} · ` : ''}{r.email}</span>
                  </label>
                ))}
              </fieldset>
            )}
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="A note for the client (optional)" aria-label="A note for the client" />
            {info.link && (
              <p className="break-all text-[12px] text-muted-foreground">The link: {info.link}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="rounded-full" disabled={busy || picked.length === 0 || !info.link} onClick={() => void send()}>
              {busy ? 'Sending…' : `Send to ${picked.length === 1 ? '1 person' : `${picked.length} people`}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
