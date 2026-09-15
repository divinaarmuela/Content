'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useRow, useTable } from '@/lib/db-client'
import type { Client, ClientContact } from '@/lib/db-types'
import { contactIdOf, ownerChoices } from '../../lib/account-owner-core'

/**
 * WHO A SHOOT (OR A CARD) IS FOR (the owner, 15 Sep 2026: "when we create a
 * brief, it's the client's business name picked, or their name — if not
 * there we type it, which appears in contacts as their name"). The
 * business, or one of the client's people; a person who is not on the
 * client yet is added by name on the spot and picked. What is picked
 * decides whose portal the work lands on.
 */
export default function ShootFor({ clientId, value, onChange, disabled = false }: {
  clientId: string
  /** '' for the business, or a contact's id */
  value: string
  onChange: (contactId: string) => void
  disabled?: boolean
}) {
  const client = useRow<Client>('clients', clientId).row
  const contacts = useTable<ClientContact>('client_contacts', { by: useMemo(() => ({ client_id: clientId }), [clientId]) }).rows
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  const addPerson = async () => {
    const n = name.trim()
    if (!n) { toast.error('Give the person a name'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/website/clients/${clientId}/contacts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }),
      })
      const json = await res.json().catch(() => ({})) as { id?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not add them')
      if (json.id) onChange(json.id)
      setAdding(false); setName('')
      toast.success(`${n} added to ${client?.name ?? 'the client'} — this is for them`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add them')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Select value={value || 'company'} onValueChange={v => v && onChange(contactIdOf(v) ?? '')} disabled={disabled}>
        <SelectTrigger className="h-11 text-[14px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {ownerChoices(client?.name ?? 'The business', contacts).map(c => (
            <SelectItem key={c.value} value={c.value}>{c.label.replace(' — the official business account', ' — the business').replace(' — their personal account', '')}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!disabled && (!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="w-fit text-[12px] font-semibold underline underline-offset-4">+ Add a person</button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Their name" aria-label="The person’s name" className="h-11 max-w-[260px] text-[14px]"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addPerson() } }} />
          <Button type="button" disabled={saving} onClick={() => void addPerson()} className="h-11 rounded-full px-4 text-[13px] font-semibold">{saving ? 'Adding…' : 'Add'}</Button>
          <Button type="button" variant="ghost" onClick={() => setAdding(false)} className="h-11 rounded-full px-3 text-[13px]">Cancel</Button>
        </div>
      ))}
    </div>
  )
}
