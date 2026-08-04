'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Mail, Phone, Pencil, Plus, Star, Trash2, UserRound, X, Copy } from 'lucide-react'

type Contact = {
  id: string
  name: string
  role: string
  email: string
  phone: string
  is_primary: boolean
  notes: string
}

const BLANK = { name: '', role: '', email: '', phone: '', is_primary: false, notes: '' }

export default function ContactsPanel({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null)
  const [draft, setDraft] = useState<Partial<Contact> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/website/clients/${clientId}/contacts`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load contacts')
      setContacts(json)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load contacts')
      setContacts([])
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!draft?.name?.trim()) return toast.error('A name is required')
    setSaving(true)
    try {
      const res = await fetch(`/api/website/clients/${clientId}/contacts`, {
        method: draft.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      toast.success(draft.id ? 'Contact updated' : 'Contact added')
      setDraft(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (c: Contact) => {
    const res = await fetch(`/api/website/clients/${clientId}/contacts?contactId=${c.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) return toast.error((await res.json()).error ?? 'Delete failed')
    toast.success(`${c.name} removed`)
    load()
  }

  const copy = (value: string, what: string) => {
    navigator.clipboard.writeText(value)
    toast.success(`${what} copied`)
  }

  if (contacts === null) return <Skeleton className="h-48 w-full" />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {contacts.length} contact{contacts.length === 1 ? '' : 's'}
        </p>
        {!draft && (
          <Button size="sm" className="ml-auto" onClick={() => setDraft({ ...BLANK })}>
            <Plus className="h-4 w-4" /> Add contact
          </Button>
        )}
      </div>

      {draft && (
        <Card className="border-blue-200 dark:border-blue-900">
          <CardContent className="grid gap-4 py-5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={draft.name ?? ''} autoFocus
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Role <span className="text-xs text-zinc-400">(owner, marketing lead…)</span></Label>
              <Input value={draft.role ?? ''}
                onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={draft.email ?? ''}
                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input value={draft.phone ?? ''}
                onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Input value={draft.notes ?? ''} placeholder="Best reached after 3pm…"
                onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch checked={!!draft.is_primary}
                onCheckedChange={v => setDraft(d => ({ ...d, is_primary: v }))} />
              <span className="text-sm">Primary contact</span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                — only one per client
              </span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save contact'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {contacts.length === 0 && !draft ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <UserRound className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              No contacts yet — add the people you actually deal with.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {contacts.map(c => (
            <Card key={c.id} className={c.is_primary ? 'border-zinc-300 dark:border-zinc-600' : undefined}>
              <CardContent className="flex flex-col gap-2.5 py-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      {c.is_primary && (
                        <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 font-normal text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                          <Star className="h-3 w-3 fill-current" /> primary
                        </Badge>
                      )}
                    </div>
                    {c.role && (
                      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                        {c.role}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7"
                      onClick={() => setDraft(c)} aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600"
                      onClick={() => remove(c)} aria-label={`Remove ${c.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {c.email && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <a href={`mailto:${c.email}`} className="min-w-0 flex-1 truncate text-zinc-600 hover:underline dark:text-zinc-300">
                      {c.email}
                    </a>
                    <button onClick={() => copy(c.email, 'Email')} aria-label="Copy email"
                      className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {c.phone && (
                  <div className="flex items-center gap-2 text-[13px]">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <a href={`tel:${c.phone}`} className="min-w-0 flex-1 truncate text-zinc-600 hover:underline dark:text-zinc-300">
                      {c.phone}
                    </a>
                    <button onClick={() => copy(c.phone, 'Phone')} aria-label="Copy phone"
                      className="text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {c.notes && (
                  <p className="text-[12px] text-zinc-500 dark:text-zinc-400">{c.notes}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
