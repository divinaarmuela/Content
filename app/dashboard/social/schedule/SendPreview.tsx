'use client'

import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

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
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')

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
        body: JSON.stringify({ emails: picked, note: note.trim() || null, ...(newEmail.trim() ? { new_contact: { name: newName.trim(), email: newEmail.trim() } } : {}) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'The preview could not be sent')
      toast.success(json.message ?? 'Preview sent')
      setOpen(false)
      setNote('')
      setNewName(''); setNewEmail(''); setAdding(false)
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
            {(info.recipients.length === 0 || adding) && (
              <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <legend className="px-1 text-[13px] font-semibold">{info.recipients.length === 0 ? 'Nobody to send to yet — who should get it?' : 'Someone else'}</legend>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Their name" aria-label="Their name" />
                <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Their email" aria-label="Their email" />
                <p className="text-[12px] text-muted-foreground">They are saved to this client&apos;s Contacts, so next time they are already here.</p>
              </fieldset>
            )}
            {info.recipients.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 text-[13px] font-semibold">Who gets it</legend>
                {info.recipients.map(r => (
                  <label key={r.email} className="flex min-h-10 items-center gap-2 text-[14px]">
                    <input type="checkbox" className="h-4 w-4" checked={picked.includes(r.email)}
                      onChange={e => setPicked(p => e.target.checked ? [...p, r.email] : p.filter(x => x !== r.email))} />
                    <span>{r.name !== r.email ? `${r.name} · ` : ''}{r.email}</span>
                  </label>
                ))}
                {!adding && <button type="button" className="mt-1 w-fit text-[13px] font-semibold underline-offset-4 hover:underline" onClick={() => setAdding(true)}>+ Someone else</button>}
              </fieldset>
            )}
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="A note for the client (optional)" aria-label="A note for the client" />
            {info.link && (
              <p className="break-all text-[12px] text-muted-foreground">The link: {info.link}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="rounded-full" disabled={busy || (picked.length === 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail.trim())) || !info.link} onClick={() => void send()}>
              {busy ? 'Sending…' : (() => { const n = picked.length + (newEmail.trim() ? 1 : 0); return `Send to ${n === 1 ? '1 person' : `${n} people`}` })()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
