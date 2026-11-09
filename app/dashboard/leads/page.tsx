'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useLive, useTable } from '@/lib/db-client'
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  ArrowRight, ArrowUpDown, Copy, Download, Mail, MoreHorizontal, RefreshCw, Trash2, UserPlus,
} from 'lucide-react'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import { LoadFailed } from '../NotSetUp'
import PageTitle from '../ui/PageTitle'
import { copyText } from '../../lib/copy-text-client'
import { acqStageByKey } from '../../lib/acquisition-core'
import { leadStatus, sourceLabel, placementLabel, pageLabel } from '../../lib/calendly-core'
import { STAGES } from '../../lib/pipeline-core'
import {
  LEADS_SUMMARY, leadBusiness, leadFromWords, leadName, leadPath, prospectForLead, prospectPagePath,
  type LeadLike, type ProspectLink,
} from '../../lib/lead-page-core'

/**
 * THE LEADS PAGE IS THE INBOX OF ENQUIRIES (the owner, 23 Sep 2026: "this
 * page needs fixing i think drawer and all dont think its from the docs").
 * The website form and the mailboxes the scanner reads land here, newest
 * first. It has no stages of its own — the acquisition pipeline is the one
 * road a deal travels, and "Bring into acquisition" is how an enquiry gets
 * on it. A row opens a page, /dashboard/leads/<id>, not a drawer.
 */
type Lead = LeadLike & {
  id: string; created_at: string
  booking_status?: string | null; booking_event?: string | null; call_at?: string | null; stage?: string | null; source_tag?: string | null
  booked_from?: string | null; ad_campaign?: string | null; ad_set?: string | null; ad_name?: string | null; ad_placement?: string | null
}

/** newest first, as the leads API always ordered them — module-level so the
 *  live query stays referentially stable across renders */
const BY_NEWEST: ['created_at', 'desc'][] = [['created_at', 'desc']]

/** 9 Nov 2026, owner: "redesign the column" + "put it in each column" (campaign, ad set, ad, placement). */
type SortKey = 'fname' | 'phone' | 'status' | 'source' | 'ad_campaign' | 'ad_set' | 'ad_name' | 'ad_placement' | 'booked_from' | 'call_at' | 'created_at'
const COLS: { key: SortKey; label: string }[] = [
  { key: 'fname',        label: 'Who' },
  { key: 'phone',        label: 'Phone' },
  { key: 'status',       label: 'Status' },
  { key: 'source',       label: 'Source' },
  { key: 'ad_campaign',  label: 'Campaign' },
  { key: 'ad_set',       label: 'Ad set' },
  { key: 'ad_name',      label: 'Ad' },
  { key: 'ad_placement', label: 'Placement' },
  { key: 'booked_from',  label: 'Booked from' },
  { key: 'call_at',      label: 'Booked' },
  { key: 'created_at',   label: 'When' },
]
const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'muted'> = { 'Call booked': 'green', 'New lead': 'blue', 'Emailed in': 'muted', Cancelled: 'red', 'Missed call': 'red' }
const statusWords = (l: Lead) => leadStatus(l, k => STAGES.find(s => s.key === k)?.label ?? k)
const sourceWords = (l: Lead) => sourceLabel(l.source)


export default function LeadsPage() {
  const router = useRouter()
  const { can } = useRole()
  const manager = can('account_manager')
  const scheduler = can('scheduler')
  const [search, setSearch]   = useState('')
  const [sort, setSort]       = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' })
  const [deleting, setDeleting] = useState<Lead | null>(null)
  const [busy, setBusy] = useState(false)

  const copyEmail = (l: Lead) => {
    void copyText(Promise.resolve(l.email ?? '')).then(ok => { if (ok) toast.success(`${l.email} copied`) })
  }

  const bringIn = async (l: Lead) => {
    setBusy(true)
    try {
      const res = await fetch('/api/leads/acquisition/from-lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: l.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Could not bring it in')
      toast.success('Brought into acquisition — it is a lead at Engaged now', {
        action: { label: 'Open', onClick: () => router.push(prospectPagePath(json.prospect.id)) },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not bring it in')
    } finally {
      setBusy(false)
    }
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
          action: { label: 'Open clients', onClick: () => router.push('/dashboard/clients') },
        })
        return
      }
      if (!res.ok) throw new Error(json.error ?? 'Convert failed')
      toast.success(`${json.name} added to clients`, {
        action: { label: 'Open clients', onClick: () => router.push('/dashboard/clients') },
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Convert failed')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${deleting.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Delete failed')
      // the listener removes the row itself
      toast.success(`Lead from ${leadName(deleting)} deleted`)
      setDeleting(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  /**
   * THE LIST, LIVE.
   *
   * Straight off the database: the table paints from the first snapshot and a
   * lead added by the website form or the inbox scanner appears in it by
   * itself, with no refetch and no reload. Newest first, exactly as
   * `/api/leads` ordered them. The prospects are read too, so a row can say
   * it is already in acquisition and link there.
   */
  const { rows: leads, loading, error } = useTable<Lead>('leads', { orderBy: BY_NEWEST })
  const { rows: prospects } = useTable<ProspectLink & { id: string }>('prospects')

  /**
   * A new lead announces itself the moment it is created. The table does not
   * need telling — its own listener has already drawn the row — so the hint
   * is the toast, plus the one banner that is still fetched.
   */
  const onLeadChange = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    const d = hint as { id?: string; label?: string; source?: string }
    if (d.id) {
      toast.success(`New lead — ${d.label}`, {
        description: d.source === 'web_form' ? 'From the website form' : undefined,
      })
    }
  }, [])
  useLive('leads', onLeadChange)

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const sortValue = (l: Lead, key: SortKey): string => {
    if (key === 'fname') return leadName(l).toLowerCase()
    if (key === 'status') return statusWords(l)
    if (key === 'source') return sourceWords(l)
    return String(l[key] ?? '').toLowerCase()
  }

  const filtered = leads
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
      return [l.fname, l.lname, l.email, l.phone, l.biz, l.need, l.ad_campaign, l.ad_name].some(v => v?.toLowerCase().includes(q))
    })
    .sort((a, b) => {
      const av = sortValue(a, sort.key), bv = sortValue(b, sort.key)
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })

  const exportExcel = () => {
    const rows = filtered.map(l => ({
      Date: l.created_at ? new Date(l.created_at).toLocaleString('en-AU') : '',
      'First name': l.fname, 'Last name': l.lname, Email: l.email, Phone: l.phone,
      Business: l.biz, Status: statusWords(l), Source: sourceWords(l), Campaign: l.ad_campaign ?? '', 'Ad set': l.ad_set ?? '', Ad: l.ad_name ?? '', Placement: placementLabel(l.ad_placement) ?? '', 'Booked from': l.booked_from ?? '', 'Call booked': l.booking_event ?? '', 'Call time': l.call_at ? new Date(l.call_at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' }) : '', Service: l.model, Needs: l.need, Budget: l.budget, Timeline: l.timeline,
      'In acquisition': prospectForLead(l, prospects) ? 'Yes' : '',
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
    : 'No leads yet. Website form fills and Calendly bookings land here by themselves.'

  const dateWords = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  /** the one chip that says where the enquiry stands */
  const status = (l: Lead) => {
    const words = statusWords(l)
    const p = prospectForLead(l, prospects)
    return (
      <div className="flex flex-col items-start gap-1">
        <Chip tone={STATUS_TONE[words] ?? 'amber'}>{words}</Chip>
        {p && <span className="whitespace-nowrap text-[12px] text-muted-foreground">{`In acquisition · ${acqStageByKey(p.stage).label}`}</span>}
      </div>
    )
  }
  const timeWords = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const dash = <span className="text-muted-foreground">—</span>
  const textCell = (v?: string | null) => <TableCell className="max-w-[180px] truncate text-secondary-13" title={v ?? undefined}>{v || dash}</TableCell>

  const open = (l: Lead) => router.push(leadPath(l.id))

  const actions = (l: Lead) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`Actions for ${leadName(l)}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => open(l)}>
          <ArrowRight className="h-3.5 w-3.5" /> Open
        </DropdownMenuItem>
        {l.email && (
          <DropdownMenuItem onClick={() => copyEmail(l)}>
            <Copy className="h-3.5 w-3.5" /> Copy email
          </DropdownMenuItem>
        )}
        {l.email && (
          <DropdownMenuItem asChild>
            <a href={`mailto:${l.email}`}>
              <Mail className="h-3.5 w-3.5" /> Email them
            </a>
          </DropdownMenuItem>
        )}
        {scheduler && !prospectForLead(l, prospects) && (
          <DropdownMenuItem disabled={busy} onClick={() => void bringIn(l)}>
            <ArrowRight className="h-3.5 w-3.5" /> Bring into acquisition
          </DropdownMenuItem>
        )}
        {manager && (
          <>
            <DropdownMenuItem onClick={() => convertToClient(l)}>
              <UserPlus className="h-3.5 w-3.5" /> Make a client
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-accent-red focus:text-accent-red" onClick={() => setDeleting(l)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="flex flex-col gap-4" data-leads-inbox>
      <PageTitle
        title="Leads"
        summary={LEADS_SUMMARY}
        actions={<>
          <div className="flex items-center gap-2">
            {/* Export is a monthly reporting job. It used to be the only filled
                button on the page, so the page looked like it was FOR exporting
                — the daily work is opening a lead and contacting it. */}
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> Export ({filtered.length})
            </Button>
          </div>
        </>}
      />


      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, email, business, what they wrote…"
          className="max-w-xs bg-surface"
        />
        {search && (
          <span className="font-mono text-secondary-13 text-muted-foreground">
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
        <LoadFailed what="your leads" detail={error} onRetry={() => window.location.reload()} />
      ) : (
        <>
        {/* Below md the table is about one and a half columns wide. Same
            data, stacked, with the one thing you came to do. */}
        <div className="flex flex-col gap-2 md:hidden">
          {filtered.length === 0 ? (
            <Card className="border-dashed shadow-none">
              <CardContent className="py-10 text-center text-body-15 text-muted-foreground">
                {emptyMessage}
              </CardContent>
            </Card>
          ) : filtered.map(l => (
            <Card key={l.id} className="py-0">
              <CardContent className="flex items-center gap-3 p-3">
                <button type="button" onClick={() => open(l)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-body-15 font-medium">{leadBusiness(l)}</p>
                  <p className="truncate text-secondary-13 text-muted-foreground">
                    {[leadName(l), l.model].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{dateWords(l.created_at)} · {sourceWords(l)}{l.ad_campaign ? ` · ${l.ad_campaign}` : ''}</p>
                  {l.phone && <p className="text-secondary-13">{l.phone}</p>}
                  <div className="mt-1.5">{status(l)}</div>
                </button>
                {actions(l)}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="hidden py-0 md:block">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-foreground/[0.04] hover:bg-foreground/[0.04]">
                  {COLS.map(c => (
                    <TableHead key={c.key}>
                      <button
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 whitespace-nowrap text-secondary-13 font-medium ${sort.key === c.key ? 'text-foreground' : 'text-muted-foreground'}`}
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
                    <TableCell colSpan={COLS.length + 1} className="py-12 text-center text-body-15 text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(l => (
                    // the row is the click target and opens the lead's page
                    <TableRow key={l.id} onClick={() => open(l)} className="cursor-pointer">
                      <TableCell className="max-w-[240px] text-body-15">
                        <p className="truncate font-medium">{leadName(l)}</p>
                        {l.email && <a href={`mailto:${l.email}`} onClick={e => e.stopPropagation()} className="block truncate text-secondary-13 text-accent-blue-deep hover:underline">{l.email}</a>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-secondary-13">
                        {l.phone ? <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} onClick={e => e.stopPropagation()} className="hover:underline">{l.phone}</a> : dash}
                      </TableCell>
                      <TableCell>{status(l)}</TableCell>
                      <TableCell className="whitespace-nowrap text-secondary-13">{sourceWords(l)}</TableCell>
                      {textCell(l.ad_campaign)}
                      {textCell(l.ad_set)}
                      {textCell(l.ad_name)}
                      {textCell(placementLabel(l.ad_placement))}
                      <TableCell className="max-w-[160px] truncate text-secondary-13" title={l.booked_from ?? undefined}>{pageLabel(l.booked_from) ?? dash}</TableCell>
                      <TableCell className="max-w-[200px] text-secondary-13">
                        {l.booking_event || l.call_at ? <>
                          <p className="truncate">{l.booking_event ?? 'Call'}</p>
                          {l.call_at && <p className={`whitespace-nowrap text-muted-foreground ${l.booking_status === 'cancelled' ? 'line-through' : ''}`}>{timeWords(l.call_at)}</p>}
                        </> : dash}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-secondary-13 text-muted-foreground">{dateWords(l.created_at)}</TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>{actions(l)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        </>
      )}

      <AlertDialog open={!!deleting} onOpenChange={open => !open && !busy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              The enquiry from {deleting ? leadName(deleting) : ''} is removed for good. If it was brought into acquisition, that prospect stays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={busy} className="bg-accent-red text-white hover:bg-accent-red/90">
              {busy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
