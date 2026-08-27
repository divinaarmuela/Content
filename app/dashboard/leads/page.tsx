'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRealtime } from 'inngest/react'
import { leadsChannel } from '@/app/inngest/channels'
import { fetchLeadsSubscriptionToken } from './actions'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ArrowUpDown, Copy, Download, Mail, MoreHorizontal, Pencil, RefreshCw, Trash2, UserPlus,
} from 'lucide-react'
import ScanPanel from './ScanPanel'
import { useRole } from '../useRole'
import { LoadFailed } from '../NotSetUp'

interface Lead {
  id: string
  created_at: string
  fname: string
  lname: string
  email: string
  phone: string
  biz: string
  model: string
  need: string
  budget: string
  timeline: string
}

const COLS: { key: keyof Lead; label: string; mono?: boolean }[] = [
  { key: 'created_at', label: 'Date', mono: true },
  { key: 'fname',      label: 'First' },
  { key: 'lname',      label: 'Last' },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone', mono: true },
  { key: 'biz',        label: 'Business' },
  { key: 'model',      label: 'Service' },
  { key: 'need',       label: 'Needs' },
  { key: 'budget',     label: 'Budget', mono: true },
  { key: 'timeline',   label: 'Timeline', mono: true },
]

type TodayLead = { id: string; created_at: string; name: string; biz: string | null; source: string; reason: string }

export default function LeadsPage() {
  const { can } = useRole()
  const canScan = can('account_manager')
  const [leads, setLeads]     = useState<Lead[]>([])
  const [today, setToday] = useState<TodayLead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<{ key: keyof Lead; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' })
  const [deleting, setDeleting] = useState<Lead | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [detail, setDetail] = useState<Lead | null>(null)
  const [draft, setDraft] = useState<Partial<Lead>>({})
  const [saveBusy, setSaveBusy] = useState(false)

  const openDetail = (l: Lead) => { setDetail(l); setDraft(l) }

  const saveDetail = async () => {
    if (!detail) return
    setSaveBusy(true)
    try {
      const res = await fetch(`/api/leads/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setLeads(ls => ls.map(l => l.id === detail.id ? json : l))
      toast.success('Lead updated')
      setDetail(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaveBusy(false)
    }
  }

  const copyEmail = (l: Lead) => {
    navigator.clipboard.writeText(l.email)
    toast.success(`${l.email} copied`)
  }

  const convertToClient = async (l: Lead) => {
    try {
      const res = await fetch('/api/website/clients/convert-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: l.id }),
      })
      const json = await res.json()
      if (res.status === 409) {
        toast.info(json.error, {
          action: { label: 'Open clients', onClick: () => { window.location.href = '/dashboard/clients' } },
        })
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Convert failed')
      toast.success(`${json.name} added to clients`, {
        action: { label: 'Open clients', onClick: () => { window.location.href = '/dashboard/clients' } },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Convert failed')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = await fetch(`/api/leads/${deleting.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      // optimistic local removal — no full refetch needed
      setLeads(ls => ls.filter(l => l.id !== deleting.id))
      toast.success(`Lead from ${deleting.fname} ${deleting.lname} deleted`)
      setDeleting(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleteBusy(false)
    }
  }

  /** `quiet` refreshes in the background: no spinner, no error banner. A poll
   *  that flickers the table or shouts about a dropped packet is worse than no
   *  poll at all. */
  const fetchLeads = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(null) }
    try {
      const res = await fetch('/api/leads')
      void fetch('/api/leads/today').then(async r => {
        if (r.ok) setToday((await r.json()).leads ?? [])
      })
      if (!res.ok) throw new Error(`${res.status}`)
      setLeads(await res.json())
    } catch (e) {
      // env-var names belong in the console, not in front of whoever is
      // chasing this morning's enquiries
      console.error('[leads] load failed', e)
      if (!quiet) setError(e instanceof Error ? e.message : 'unknown')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLeads() }, [fetchLeads])

  /**
   * Live: a lead announces itself the moment it is created, from the contact
   * form or the inbox scanner. The message is treated as a hint, not data —
   * we refetch through the authenticated /api/leads rather than splicing the
   * payload in, so there is one definition of what a lead looks like.
   */
  const { messages } = useRealtime({
    channel: leadsChannel,
    topics: ['created'] as const,
    token: () => fetchLeadsSubscriptionToken(),
    // fan-out channel: it never "completes", so do not auto-close
    autoCloseOnTerminal: false,
    historyLimit: 20,
  })

  const seen = useRef<Set<string>>(new Set())
  useEffect(() => {
    const latest = messages.last
    if (!latest) return
    const d = latest.data as { id: string; label: string; source: string }
    // the publish path outside a function is not retry-safe, so a duplicate
    // announcement is expected rather than exceptional
    if (!d?.id || seen.current.has(d.id)) return
    seen.current.add(d.id)
    toast.success(`New lead — ${d.label}`, {
      description: d.source === 'web_form' ? 'From the website form' : 'Found in the inbox',
    })
    void fetchLeads(true)
  }, [messages.last, fetchLeads])

  /**
   * Belt to realtime's braces. Realtime covers the instant case; this covers
   * a dropped socket, a sleeping laptop, and a lead created while the tab was
   * in the background. Only while visible — an unwatched tab polling all
   * afternoon is pure waste — and immediately on returning to the tab, which
   * is the moment someone actually wants to know what arrived.
   */
  useEffect(() => {
    const tick = () => { if (!document.hidden) void fetchLeads(true) }
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [fetchLeads])

  const toggleSort = (key: keyof Lead) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const filtered = leads
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
      return [l.fname, l.lname, l.email, l.biz].some(v => v?.toLowerCase().includes(q))
    })
    .sort((a, b) => {
      const av = a[sort.key] ?? '', bv = b[sort.key] ?? ''
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })

  const exportExcel = () => {
    const rows = filtered.map(l => ({
      Date: l.created_at ? new Date(l.created_at).toLocaleString('en-AU') : '',
      'First name': l.fname, 'Last name': l.lname, Email: l.email, Phone: l.phone,
      Business: l.biz, Service: l.model, Needs: l.need, Budget: l.budget, Timeline: l.timeline,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, `md-leads-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  /** "No leads yet" used to show when a SEARCH found nothing, so looking for a
   *  name that isn't there told you the business had no enquiries at all. */
  const emptyMessage = search.trim()
    ? `No leads match “${search.trim()}”. Clear the search to see all ${leads.length}.`
    : 'No leads yet — submissions appear here automatically.'

  const fmt = (val: string, key: keyof Lead) => {
    if (key === 'created_at' && val)
      return new Date(val).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
    return val || '—'
  }

  return (
    <div className="flex flex-col gap-4">
      {today.length > 0 && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="flex items-center gap-2">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-emerald-600 px-1.5 font-mono text-xs font-semibold text-white">
              +{today.length}
            </span>
            <h3 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
              New lead{today.length === 1 ? '' : 's'} today
            </h3>
          </div>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {today.map(t => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-sm text-emerald-950 dark:text-emerald-100">
                <span className="font-mono text-xs tabular-nums text-emerald-700 dark:text-emerald-400">
                  {new Date(t.created_at).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="font-medium">{t.name}</span>
                {t.biz && <span className="text-emerald-800 dark:text-emerald-300">({t.biz})</span>}
                <span className={
                  'rounded-full px-1.5 py-px font-mono text-[11px] uppercase tracking-wide ' +
                  (t.source === 'web_form'
                    ? 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
                    : 'bg-sky-600/15 text-sky-800 dark:text-sky-300')
                }>
                  {t.source === 'web_form' ? 'web form' : 'scanner'}
                </span>
                <span className="basis-full text-xs text-emerald-800/80 dark:text-emerald-300/80">{t.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Leads</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Contact form submissions from mdmmarketing.com.au</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* wrapped: passing fetchLeads directly hands it the click event as
              its `quiet` argument, silencing the very errors this button exists
              to surface */}
          <Button variant="outline" size="sm" onClick={() => fetchLeads()}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          {/* Export is a monthly reporting job. It used to be the only filled
              button on the page, so the page looked like it was FOR exporting
              — the daily work is opening a lead and contacting it. */}
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Export ({filtered.length})
          </Button>
        </div>
      </div>

      {/* Scanning reads the agency mailbox and creates leads — account_manager
          and above. The API enforces the same rule; this only stops the
          control being offered to people it would reject. */}
      {canScan && <ScanPanel onLeadsCreated={fetchLeads} />}

      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, business…"
          className="max-w-xs bg-white dark:bg-zinc-900"
        />
        {search && (
          <span className="font-mono text-xs text-zinc-400 dark:text-zinc-500">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
          </CardContent>
        </Card>
      ) : error ? (
        <LoadFailed what="your leads" detail={error} onRetry={() => fetchLeads()} />
      ) : (
        <>
        {/* Below md the eleven-column table is about one and a half columns
            wide. Same data, stacked, with the one thing you came to do. */}
        <div className="flex flex-col gap-2 md:hidden">
          {filtered.length === 0 ? (
            <Card className="border-dashed shadow-none">
              <CardContent className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                {emptyMessage}
              </CardContent>
            </Card>
          ) : filtered.map((l, i) => (
            <Card key={l.id ?? i} className="py-0">
              <CardContent className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{l.fname} {l.lname}</p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {[l.biz, l.model].filter(Boolean).join(' · ') || l.email}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-400">{fmt(l.created_at, 'created_at')}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => openDetail(l)}>View</Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="hidden py-0 md:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-900">
                  {COLS.map(c => (
                    <TableHead key={c.key}>
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium ${sort.key === c.key ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}
                      >
                        {c.label}
                        <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                  ))}
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLS.length + 1} className="py-12 text-center text-sm text-zinc-400 dark:text-zinc-500">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((l, i) => (
                    // the row is the click target: opening a lead was hidden
                    // behind a kebab, and clicking the row itself did nothing
                    <TableRow
                      key={l.id ?? i}
                      onClick={() => openDetail(l)}
                      className="cursor-pointer"
                    >
                      {COLS.map(c => (
                        <TableCell
                          key={c.key}
                          className={`max-w-[220px] truncate text-sm ${c.mono ? 'font-mono text-xs text-zinc-500 dark:text-zinc-400' : ''}`}
                          title={l[c.key] ?? ''}
                        >
                          {c.key === 'email'
                            ? <a href={`mailto:${l.email}`} onClick={e => e.stopPropagation()} className="text-blue-600 dark:text-blue-400 hover:underline">{l.email}</a>
                            : fmt(l[c.key], c.key)}
                        </TableCell>
                      ))}
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-zinc-400 dark:text-zinc-500"
                              aria-label={`Actions for ${l.fname} ${l.lname}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => openDetail(l)}>
                              <Pencil className="h-3.5 w-3.5" /> View &amp; edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyEmail(l)}>
                              <Copy className="h-3.5 w-3.5" /> Copy email
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`mailto:${l.email}`}>
                                <Mail className="h-3.5 w-3.5" /> Email lead
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => convertToClient(l)}>
                              <UserPlus className="h-3.5 w-3.5" /> Convert to client
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                              onClick={() => setDeleting(l)}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        </>
      )}

      <Sheet open={!!detail} onOpenChange={open => !open && !saveBusy && setDetail(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detail?.fname} {detail?.lname}</SheetTitle>
            <SheetDescription>
              {detail?.biz}
              {detail?.created_at && (
                <> · received {new Date(detail.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}</>
              )}
            </SheetDescription>
          </SheetHeader>

          <div className="grid gap-4 px-4 pb-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>First name</Label>
                <Input value={draft.fname ?? ''} onChange={e => setDraft(d => ({ ...d, fname: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Last name</Label>
                <Input value={draft.lname ?? ''} onChange={e => setDraft(d => ({ ...d, lname: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={draft.email ?? ''} onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Phone</Label>
                <Input value={draft.phone ?? ''} onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Business</Label>
                <Input value={draft.biz ?? ''} onChange={e => setDraft(d => ({ ...d, biz: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Service interest</Label>
              <Input value={draft.model ?? ''} onChange={e => setDraft(d => ({ ...d, model: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Needs — full text</Label>
              <Textarea rows={5} value={draft.need ?? ''} onChange={e => setDraft(d => ({ ...d, need: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Budget</Label>
                <Input value={draft.budget ?? ''} onChange={e => setDraft(d => ({ ...d, budget: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Timeline</Label>
                <Input value={draft.timeline ?? ''} onChange={e => setDraft(d => ({ ...d, timeline: e.target.value }))} />
              </div>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button onClick={saveDetail} disabled={saveBusy}>
                {saveBusy ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="outline" onClick={() => detail && convertToClient(detail)}>
                <UserPlus className="h-4 w-4" /> Convert to client
              </Button>
              <Button variant="outline" asChild>
                <a href={`mailto:${detail?.email}`}><Mail className="h-4 w-4" /> Email</a>
              </Button>
              <Button
                variant="ghost"
                className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400"
                onClick={() => { if (detail) { setDeleting(detail); setDetail(null) } }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={open => !open && !deleteBusy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>
                  {deleting.fname} {deleting.lname} · {deleting.biz} · {deleting.email}
                  <br />
                </>
              )}
              This permanently removes the enquiry from the database. It can&apos;t be undone —
              export to Excel first if you need a record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => { e.preventDefault(); confirmDelete() }}
              disabled={deleteBusy}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteBusy ? 'Deleting…' : 'Delete lead'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
