'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Download, Mail, Search, Sparkles, Trash2 } from 'lucide-react'
import PageTitle from '../ui/PageTitle'

type Subscriber = { id: string; email: string; source: string; created_at: string }
type Invite = { id: string; name: string; email: string; about: string | null; created_at: string }

export type AudienceTab = 'newsletter' | 'invites'

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' })

/** CSV with proper quoting — emails and "what do you do" can contain commas. */
function downloadCsv(filename: string, rows: (string | null)[][], header: string[]) {
  const cell = (v: string | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** One audience list. The tab is the ROUTE — /dashboard/audience for the
 *  newsletter, /dashboard/audience/room for invite requests — so a refresh
 *  keeps your place and either list can be linked directly. */
export default function AudienceView({ tab }: { tab: AudienceTab }) {
  const [newsletter, setNewsletter] = useState<Subscriber[] | null>(null)
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/audience')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not load audience')
      setNewsletter(json.newsletter)
      setInvites(json.invites)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load audience')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (type: AudienceTab, id: string) => {
    try {
      const res = await fetch(`/api/audience?type=${type}&id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      if (type === 'newsletter') setNewsletter(prev => prev?.filter(r => r.id !== id) ?? null)
      else setInvites(prev => prev?.filter(r => r.id !== id) ?? null)
      toast.success('Removed')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const q = query.trim().toLowerCase()
  const visibleSubs = useMemo(
    () => (newsletter ?? []).filter(s => !q || s.email.includes(q)),
    [newsletter, q],
  )
  const visibleInvites = useMemo(
    () => (invites ?? []).filter(i =>
      !q || i.email.includes(q) || i.name.toLowerCase().includes(q) || (i.about ?? '').toLowerCase().includes(q)),
    [invites, q],
  )

  const exportCsv = () => {
    if (tab === 'newsletter') {
      downloadCsv(
        'newsletter-subscribers.csv',
        visibleSubs.map(s => [s.email, s.source, s.created_at]),
        ['email', 'source', 'subscribed_at'],
      )
    } else {
      downloadCsv(
        'room-invite-requests.csv',
        visibleInvites.map(i => [i.name, i.email, i.about, i.created_at]),
        ['name', 'email', 'what_they_do', 'requested_at'],
      )
    }
  }

  const loading = newsletter === null || invites === null

  const deleteButton = (type: AudienceTab, id: string, label: string) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-accent-red" aria-label={`Remove ${label}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            {type === 'newsletter'
              ? 'They will no longer be on the field notes list. This is how you honour an unsubscribe request.'
              : 'Their invite request for The Room will be deleted.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => remove(type, id)} className="bg-accent-red hover:bg-accent-red">
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const empty = (message: string) => (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <p className="text-body-15 text-muted-foreground">{message}</p>
    </div>
  )

  const pill = (href: string, active: boolean, icon: React.ReactNode, label: string, count: number | null) => (
    <Link
      href={href}
      className={`flex items-center gap-1.5 rounded-tile px-3 py-1.5 text-body-15 transition-colors ${
        active
          ? 'bg-surface font-medium text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon} {label}
      <Badge variant="secondary" className="ml-1 px-1.5 font-mono text-[12px]">{count ?? '…'}</Badge>
    </Link>
  )

  return (
    <div className="flex flex-col gap-5">
      <PageTitle
        title="Audience"
        summary="Everyone who has asked to hear from us — the journal list and The Room."
        actions={<>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="pl-10"
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </>}
      />

      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex items-center gap-1 rounded-full border border-border bg-surface p-1">
          {pill('/dashboard/audience', tab === 'newsletter', <Mail className="h-3.5 w-3.5" />, 'Newsletter', newsletter?.length ?? null)}
          {pill('/dashboard/audience/room', tab === 'invites', <Sparkles className="h-3.5 w-3.5" />, 'The Room', invites?.length ?? null)}
        </nav>

      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex flex-col gap-3 p-6">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : tab === 'newsletter' ? (
            visibleSubs.length === 0 ? (
              empty(q ? 'No subscribers match that search.' : 'No subscribers yet — the journal form feeds this list.')
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead className="hidden sm:table-cell">Source</TableHead>
                      <TableHead>Subscribed</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleSubs.map(s => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.email}</TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge variant="outline" className="font-mono text-[12px] capitalize">{s.source}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(s.created_at)}</TableCell>
                        <TableCell>{deleteButton('newsletter', s.id, s.email)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : visibleInvites.length === 0 ? (
            empty(q ? 'No requests match that search.' : 'No invite requests yet — the events page form feeds this list.')
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead className="hidden md:table-cell">What they do</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleInvites.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.name}</TableCell>
                      <TableCell className="text-muted-foreground">{i.email}</TableCell>
                      <TableCell className="hidden max-w-md truncate text-muted-foreground md:table-cell">
                        {i.about || '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(i.created_at)}</TableCell>
                      <TableCell>{deleteButton('invites', i.id, i.name)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
