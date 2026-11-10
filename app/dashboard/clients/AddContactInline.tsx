'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ClientRecipient } from '@/app/lib/client-recipients-core'

/**
 * "Nobody to send to? Type them here." (10 Nov 2026) — one box for every send-to-client dialog. Saves the person on the
 * client's Contacts (/api/clients/[id]/quick-contact) and hands them back so the dialog can tick them; next time they are
 * already in the list to choose from.
 */
export default function AddContactInline({ clientId, onAdded, title }: { clientId: string; onAdded: (r: ClientRecipient) => void; title?: string }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const save = async () => {
    setBusy(true)
    try {
      const r = await fetch(`/api/clients/${encodeURIComponent(clientId)}/quick-contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), email: email.trim() }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Could not add them')
      toast.success(`${j.recipient.name} added to this client's Contacts`)
      onAdded(j.recipient as ClientRecipient)
      setName(''); setEmail('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add them') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-2 rounded-inner border border-dashed border-border p-3" data-add-contact-inline>
      <p className="text-[13px] font-semibold">{title ?? 'Nobody to send to yet — who should get it?'}</p>
      <Input value={name} onChange={e => setName(e.target.value)} placeholder="Their name" aria-label="Their name" />
      <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Their email" aria-label="Their email"
        onKeyDown={e => { if (e.key === 'Enter' && ok && !busy) { e.preventDefault(); void save() } }} />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="rounded-full" disabled={!ok || busy} onClick={() => void save()}>{busy ? 'Adding…' : 'Add and tick them'}</Button>
        <span className="text-[12px] text-muted-foreground">Saved to this client&apos;s Contacts for next time.</span>
      </div>
    </div>
  )
}
