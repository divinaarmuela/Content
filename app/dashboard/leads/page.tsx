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
import ScanPanel from './ScanPanel'
import Chip from '../ui/Chip'
import { useRole } from '../useRole'
import { LoadFailed } from '../NotSetUp'
import PageTitle from '../ui/PageTitle'
import { copyText } from '../../lib/copy-text-client'
import { acqStageByKey } from '../../lib/acquisition-core'
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
type Lead = LeadLike & { id: string; created_at: string }

/** newest first, as the leads API always ordered them — module-level so the
 *  live query stays referentially stable across renders */
const BY_NEWEST: ['created_at', 'desc'][] = [['created_at', 'desc']]

type SortKey = 'created_at' | 'fname' | 'biz' | 'source' | 'model'
const COLS: { key: SortKey; label: string }[] = [
  { key: 'created_at', label: 'When' },
  { key: 'fname',      label: 'Who' },
  { key: 'biz',        label: 'Business' },
  { key: 'source',     label: 'From' },
  { key: 'model',      label: 'Asked for' },
]

type TodayLead = { id: string; created_at: string; name: string; biz: string | null; source: string; reason: string }

export default function LeadsPage() {
  const router = useRouter()
  const { can } = useRole()
  const canScan = can('account_manager')
  const manager = can('account_manager')
  const scheduler = can('scheduler')
  const [today, setToday] = useState<TodayLead[]>([])
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

  /** today's leads carry WHY they exist — the classifier's reasoning, which
   *  lives in the ingest log — so that one banner is still its own fetch */
  const loadToday = useCallback(() => {
    void fetch('/api/leads/today')
      .then(async r => { if (r.ok) setToday((await r.json()).leads ?? []) })
      .catch(() => { /* the banner is a bonus; the table is the page */ })
  }, [])
  useEffect(() => { loadToday() }, [loadToday])

  /**
   * A new lead announces itself the moment it is created. The table does not
   * need telling — its own listener has already drawn the row — so the hint
   * is the toast, plus the one banner that is still fetched.
   */
  const onLeadChange = useCallback((hint: Record<string, unknown> & { ts: number }) => {
    const d = hint as { id?: string; label?: string; source?: string }
    if (d.id) {
      toast.success(`New lead — ${d.label}`, {
        description: d.source === 'web_form' ? 'From the website form' : 'Found in the inbox',
      })
    }
    loadToday()
  }, [loadToday])
  useLive('leads', onLeadChange)

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })

  const sortValue = (l: Lead, key: SortKey): string => {
    if (key === 'fname') return leadName(l).toLowerCase()
    if (key === 'biz') return leadBusiness(l).toLowerCase()
    if (key === 'source') return leadFromWords(l.source)
    return String(l[key] ?? '').toLowerCase()
  }

  const filtered = leads
    .filter(l => {
      if (!search) return true
      const q = search.toLowerCase()
      return [l.fname, l.lname, l.email, l.biz, l.need].some(v => v?.toLowerCase().includes(q))
    })
    .sort((a, b) => {
      const av = sortValue(a, sort.key), bv = sortValue(b, sort.key)
      return sort.dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })

  const exportExcel = () => {
    const rows = filtered.map(l => ({
      Date: l.created_at ? new Date(l.created_at).toLocaleString('en-AU') : '',
      'First name': l.fname, 'Last name': l.lname, Email: l.email, Phone: l.phone,
      Business: l.biz, From: leadFromWords(l.source), Service: l.model, Needs: l.need, Budget: l.budget, Timeline: l.timeline,
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
    : 'No enquiries yet — the website form and the inbox scanner put them here by themselves.'

  const dateWords = (iso: string) => iso ? new Date(iso).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  /** the one chip that says where the enquiry stands */
  const status = (l: Lead) => {
    const p = prospectForLead(l, prospects)
    if (p) return <Chip tone="green">{`In acquisition · ${acqStageByKey(p.stage).label}`}</Chip>
    if (l.next_action) return <Chip tone="amber">{l.next_action}</Chip>
    return <Chip tone="muted">Not brought in</Chip>
  }

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
      {today.length > 0 && (
        <div className="rounded-inner border border-accent-green/30 bg-tint-green p-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-green px-1.5 font-mono text-secondary-13 font-semibold text-white">
              +{today.length}
            </span>
            <h3 className="text-body-15 font-semibold text-foreground">
              New lead{today.length === 1 ? '' : 's'} today
            </h3>
          </div>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {today.map(t => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 text-body-15 text-foreground">
                <span className="font-mono text-secondary-13 tabular-nums text-foreground">
                  {new Date(t.created_at).toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit' })}
                </span>
                <button type="button" onClick={() => router.push(leadPath(t.id))} className="font-medium underline-offset-4 hover:underline">{t.name}</button>
                {t.biz && <span className="text-foreground">({t.biz})</span>}
                <span className={
                  'rounded-full px-1.5 py-px font-mono text-[12px] uppercase tracking-wide ' +
                  (t.source === 'web_form'
                    ? 'bg-accent-green text-foreground'
                    : 'bg-accent-blue text-accent-blue-deep')
                }>
                  {t.source === 'web_form' ? 'web form' : 'scanner'}
                </span>
                <span className="basis-full text-secondary-13 text-foreground">{t.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PageTitle
        title="Leads"
        summary={LEADS_SUMMARY}
        actions={<>
          <div className="flex items-center gap-2">
            {/* the table is live, so this refreshes the one thing that is not:
                today's leads and the reason each of them exists */}
            <Button variant="outline" size="sm" onClick={() => loadToday()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {/* Export is a monthly reporting job. It used to be the only filled
                button on the page, so the page looked like it was FOR exporting
                — the daily work is opening a lead and contacting it. */}
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={filtered.length === 0}>
              <Download className="h-4 w-4" /> Export ({filtered.length})
            </Button>
          </div>
        </>}
      />

      {/* Scanning reads the agency mailbox and creates leads — account_manager
          and above. The API enforces the same rule; this only stops the
          control being offered to people it would reject. */}
      {canScan && <ScanPanel onLeadsCreated={loadToday} />}

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
                  <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">{dateWords(l.created_at)} · {leadFromWords(l.source)}</p>
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
                  <TableHead>Where it stands</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={COLS.length + 2} className="py-12 text-center text-body-15 text-muted-foreground">
                      {emptyMessage}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map(l => (
                    // the row is the click target and opens the lead's page
                    <TableRow key={l.id} onClick={() => open(l)} className="cursor-pointer">
                      <TableCell className="whitespace-nowrap font-mono text-secondary-13 text-muted-foreground">{dateWords(l.created_at)}</TableCell>
                      <TableCell className="max-w-[220px] text-body-15">
                        <p className="truncate font-medium">{leadName(l)}</p>
                        {l.email && <a href={`mailto:${l.email}`} onClick={e => e.stopPropagation()} className="block truncate text-secondary-13 text-accent-blue-deep hover:underline">{l.email}</a>}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-body-15" title={leadBusiness(l)}>{leadBusiness(l)}</TableCell>
                      <TableCell className="whitespace-nowrap text-secondary-13 text-muted-foreground">{leadFromWords(l.source)}</TableCell>
                      <TableCell className="max-w-[320px] text-body-15">
                        <p className="truncate">{l.model || '—'}</p>
                        {l.need && <p className="truncate text-secondary-13 text-muted-foreground" title={l.need}>{l.need}</p>}
                      </TableCell>
                      <TableCell>{status(l)}</TableCell>
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
