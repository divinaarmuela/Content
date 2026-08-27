'use client'

import Link from 'next/link'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { publicUrl } from '@/app/lib/public-url'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Plus, Pencil, Trash2, Link2, Search, ArrowRight } from 'lucide-react'
import SocialChannels from './SocialChannels'
import { friendlyError } from '@/app/lib/support-core'

type Client = {
  id: string
  created_at: string
  name: string
  slug: string
  industry: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  website?: string | null
  source?: string
  share_token?: string
  status: 'prospect' | 'active' | 'paused' | 'archived'
  notes: string | null
  /** who runs this client — from team_user_clients, attached by the list API */
  managers?: { id: string; name: string; email: string }[]
}

/** Initials for the manager chip: "Abby Chen" → AC, else the email's first
 *  two letters, so an invited-but-unnamed manager still reads as somebody. */
const initials = (name: string, email: string) =>
  (name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('')

const EMPTY: Partial<Client> = { name: '', industry: '', contact_name: '', email: '', phone: '', website: '', status: 'active', notes: '' }

const STATUS_STYLE: Record<string, string> = {
  prospect: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900',
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
  paused:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
  archived: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800',
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null)
  const [editing, setEditing] = useState<Partial<Client> | null>(null)
  const [deleting, setDeleting] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const visible = (clients ?? []).filter(c =>
    !q || [c.name, c.slug, c.industry, c.contact_name, c.email]
      .some(field => (field ?? '').toLowerCase().includes(q)),
  )

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/website/clients')
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load')
      setClients(await res.json())
    } catch (e) {
      // the raw string may name a .sql file or an env var; that is for the
      // console, never for the account manager reading this page
      console.error('[clients] load failed', e)
      toast.error(friendlyError(e instanceof Error ? e.message : null, 'Clients'))
      setClients([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.name) return toast.error('Name is required')
    setSaving(true)
    try {
      const isNew = !editing.id
      const res = await fetch(isNew ? '/api/website/clients' : `/api/website/clients/${editing.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      toast.success(isNew ? 'Client added' : 'Client updated')
      setEditing(null)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    const res = await fetch(`/api/website/clients/${deleting.id}`, { method: 'DELETE' })
    if (!res.ok) return toast.error('Delete failed')
    toast.success(`${deleting.name} deleted`)
    setDeleting(null)
    load()
  }

  const set = (patch: Partial<Client>) => setEditing(e => ({ ...e, ...patch }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Clients</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Every client we work with. Add one here before booking a shoot or
            connecting their social accounts.
          </p>
        </div>
        <Dialog open={!!editing} onOpenChange={open => !open && setEditing(null)}>
          <DialogTrigger asChild>
            <Button size="sm" className="ml-auto" onClick={() => setEditing({ ...EMPTY })}>
              <Plus className="h-4 w-4" /> Add client
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing?.id ? `Edit · ${editing.name}` : 'New client'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Name *</Label>
                <Input value={editing?.name ?? ''} onChange={e => set({ name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Industry</Label>
                <Input value={editing?.industry ?? ''} onChange={e => set({ industry: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={editing?.status ?? 'active'} onValueChange={v => set({ status: v as Client['status'] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Contact name</Label>
                <Input value={editing?.contact_name ?? ''} onChange={e => set({ contact_name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={editing?.phone ?? ''} onChange={e => set({ phone: e.target.value })} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Email</Label>
                <Input type="email" value={editing?.email ?? ''} onChange={e => set({ email: e.target.value })} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Website</Label>
                <Input value={editing?.website ?? ''} placeholder="https://…" onChange={e => set({ website: e.target.value })} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea rows={3} value={editing?.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
              </div>
            </div>

            {/* Channels need a saved client to attach to — a provider profile
                is created against the client id on first connect. */}
            {editing?.id ? (
              <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
                <SocialChannels clientId={editing.id} />
              </div>
            ) : (
              <p className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Save the client first, then reopen to connect their social channels.
              </p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save client'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search across the things someone actually remembers about a client —
          the name, the slug, the industry, or whoever they deal with. */}
      {clients !== null && clients.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="bg-white pl-8 dark:bg-zinc-900"
            />
          </div>
          {search && (
            <span className="font-mono text-xs text-zinc-400">
              {visible.length} of {clients.length}
            </span>
          )}
        </div>
      )}

      {clients === null ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
          </CardContent>
        </Card>
      ) : clients.length === 0 ? (
        <Card className="border-dashed shadow-none">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40">
              <Plus className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">No clients yet</p>
              <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                Add one manually, or import the current site projects from the Website page. It creates a client per project automatically.
              </p>
            </div>
            <div className="mt-1 flex gap-2">
              <Button size="sm" onClick={() => setEditing({ ...EMPTY })}>
                <Plus className="h-4 w-4" /> Add client
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="/dashboard/website">Go to Website</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* no `overflow-hidden`: the Table primitive scrolls itself, and an
           overflow-hidden Card outside it CLIPPED the right-hand columns —
           status and the row actions simply were not there on a phone */
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                <TableHead>Client</TableHead>
                <TableHead>Account manager</TableHead>
                <TableHead className="hidden lg:table-cell">Industry</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/dashboard/clients/${c.id}`} className="group block">
                      <div className="text-sm font-medium group-hover:underline">{c.name}</div>
                      <div className="font-mono text-xs text-zinc-400 dark:text-zinc-500">{c.slug}</div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {(c.managers?.length ?? 0) === 0 ? (
                      <Link
                        href={`/dashboard/clients/${c.id}`}
                        className="text-xs text-amber-600 hover:underline dark:text-amber-500"
                      >
                        Unassigned
                      </Link>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.managers!.map(m => (
                          <span
                            key={m.id}
                            title={`${m.name || m.email} · ${m.email}`}
                            className="flex items-center gap-1.5 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2 dark:border-zinc-700"
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 font-mono text-[9px] text-white dark:bg-zinc-700">
                              {initials(m.name, m.email)}
                            </span>
                            <span className="max-w-28 truncate text-xs text-zinc-600 dark:text-zinc-300">
                              {m.name || m.email}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm text-zinc-600 lg:table-cell dark:text-zinc-400">{c.industry || '—'}</TableCell>
                  <TableCell>
                    <div className="text-sm">{c.contact_name || '—'}</div>
                    {c.email && <a href={`mailto:${c.email}`} className="block text-xs text-blue-600 dark:text-blue-400 hover:underline">{c.email}</a>}
                    {c.website && (
                      <a href={c.website} target="_blank" rel="noreferrer noopener"
                        className="block text-xs text-zinc-500 hover:underline dark:text-zinc-400">
                        {c.website.replace(/^https?:\/\//i, '')}
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`capitalize ${STATUS_STYLE[c.status] ?? ''}`}>{c.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {c.share_token && (
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          // the link is NOT read-only: whoever holds it can
                          // approve content and shoot plans
                          aria-label={`Copy client portal link for ${c.name} (they can approve from it)`}
                          title={`Copy client portal link for ${c.name} (they can approve from it)`}
                          onClick={() => {
                            navigator.clipboard.writeText(publicUrl(`/portal/${c.share_token}`))
                            toast.success(`Portal link for ${c.name} copied — anyone with it can approve`)
                          }}
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(c)} aria-label="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300" onClick={() => setDeleting(c)} aria-label="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog open={!!deleting} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They disappear from every client list, and their website projects stay but lose the link back. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
