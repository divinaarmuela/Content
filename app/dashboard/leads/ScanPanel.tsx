'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Eye, Filter,
  Inbox, Loader2, MailCheck, MinusCircle, RotateCw, UserPlus,
} from 'lucide-react'

/* ── shapes mirrored from app/lib/email-lead.ts ────────────────────────── */

type Outcome =
  | 'already_processed' | 'prefiltered' | 'not_a_lead'
  | 'duplicate_sender' | 'lead_created' | 'needs_review' | 'error'

type ScanEvent =
  | { type: 'start'; mailboxes: string[] }
  | { type: 'mailbox_start'; email: string; index: number; total: number }
  | { type: 'listed'; email: string; count: number }
  | { type: 'message'; email: string; outcome: Outcome; subject?: string; from?: string; reason?: string; confidence?: number }
  | { type: 'mailbox_done'; email: string }
  | { type: 'mailbox_error'; email: string; message: string }
  | { type: 'done'; result: ScanResult }
  | { type: 'report'; report: unknown }
  | { type: 'fatal'; message: string }

type ScanResult = {
  scanned: number; claimed: number; leads_created: number
  skipped: number; errors: number; mailboxes: string[]
}

type LogEntry = {
  id: string
  created_at: string
  mailbox: string
  from_email: string | null
  subject: string | null
  status: 'pending' | 'lead_created' | 'not_a_lead' | 'skipped' | 'error' | 'needs_review'
  confidence: number | null
  reasoning: string | null
  error: string | null
  lead_id: string | null
}

type Conn = {
  mine: { connected: boolean; email: string | null; reason?: string }
  shared: string[]
  /** connected by their owner through "Connect my inbox" */
  self?: string[]
  connected: string[]
}

/* ── presentation for each outcome ─────────────────────────────────────── */

const OUTCOME: Record<Outcome, { label: string; tone: string; Icon: typeof Inbox }> = {
  lead_created:      { label: 'Lead created',   tone: 'text-foreground', Icon: UserPlus },
  not_a_lead:        { label: 'Not an enquiry', tone: 'text-muted-foreground',       Icon: MinusCircle },
  prefiltered:       { label: 'Not worth reading', tone: 'text-foreground',     Icon: Filter },
  duplicate_sender:  { label: 'Already a lead', tone: 'text-accent-blue-deep',         Icon: MailCheck },
  already_processed: { label: 'Seen before',    tone: 'text-muted-foreground',       Icon: CheckCircle2 },
  needs_review:      { label: 'Needs review',   tone: 'text-accent-blue-deep',   Icon: Eye },
  error:             { label: 'Error',          tone: 'text-foreground',         Icon: AlertTriangle },
}

const STATUS: Record<LogEntry['status'], { label: string; cls: string }> = {
  lead_created: { label: 'Lead created', cls: 'bg-tint-green text-foreground' },
  not_a_lead:   { label: 'Not an enquiry', cls: 'bg-foreground/[0.06] text-muted-foreground' },
  skipped:      { label: 'Not worth reading', cls: 'bg-tint-amber text-foreground' },
  error:        { label: 'Error',        cls: 'bg-tint-red text-foreground' },
  pending:      { label: 'In progress',  cls: 'bg-foreground/[0.06] text-muted-foreground' },
  needs_review: { label: 'Needs review', cls: 'bg-tint-blue text-accent-blue-deep' },
}

function relative(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

/** Timestamps are stored UTC; staff read them in Melbourne time. Every relative
 *  time carries the absolute local time as a tooltip so the two never have to be
 *  reconciled by hand. */
function absolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/* ── component ─────────────────────────────────────────────────────────── */

export default function ScanPanel({ onLeadsCreated }: { onLeadsCreated: () => void }) {
  const [conn, setConn]       = useState<Conn | null>(null)
  const [log, setLog]         = useState<LogEntry[]>([])
  const [logLoading, setLogLoading] = useState(true)
  const [lastScan, setLastScan]     = useState<string | null>(null)

  const [busy, setBusy]       = useState(false)
  const [phase, setPhase]     = useState<string>('')
  const [live, setLive]       = useState<ScanEvent[]>([])
  const [result, setResult]   = useState<ScanResult | null>(null)
  const [fatal, setFatal]     = useState<string | null>(null)
  const [open, setOpen]       = useState(false)

  const liveRef = useRef<HTMLDivElement>(null)

  const loadLog = useCallback(async () => {
    try {
      const res = await fetch('/api/ingest/log?limit=40')
      if (!res.ok) throw new Error('log')
      const json = await res.json()
      setLog(json.entries ?? [])
      setLastScan(json.last_scan_at ?? null)
    } catch {
      /* the panel still works without history */
    } finally {
      setLogLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/ingest/connection').then(r => r.json()).then(setConn).catch(() => setConn(null))
    loadLog()
  }, [loadLog])

  // keep the live feed pinned to the newest line
  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight })
  }, [live])

  const scan = async () => {
    setBusy(true); setFatal(null); setResult(null); setLive([]); setOpen(true)
    setPhase('Connecting to Gmail…')

    try {
      const res = await fetch('/api/ingest/email', {
        method: 'POST',
        headers: { Accept: 'application/x-ndjson' },
      })
      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => null)
        throw new Error(msg?.error ?? `Scan failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // NDJSON: one event per line. A chunk can split a line, so the tail is
      // held back until its newline arrives.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          let ev: ScanEvent
          try { ev = JSON.parse(line) } catch { continue }

          if (ev.type === 'mailbox_start') setPhase(`Reading ${ev.email} (${ev.index} of ${ev.total})`)
          else if (ev.type === 'listed')   setPhase(`${ev.count} recent message${ev.count === 1 ? '' : 's'} in ${ev.email}`)
          else if (ev.type === 'message')  setPhase('Checking messages…')
          else if (ev.type === 'done')     { setResult(ev.result); setPhase('') }
          else if (ev.type === 'fatal')    setFatal(ev.message)

          if (ev.type === 'message' || ev.type === 'mailbox_error') {
            setLive(prev => [...prev, ev])
          }
        }
      }
    } catch (e) {
      setFatal(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setBusy(false)
      setPhase('')
      loadLog()
      onLeadsCreated()
    }
  }

  const mailboxes = conn ? [...conn.shared, ...(conn.self ?? []), ...conn.connected] : []
  const newLeads  = result?.leads_created ?? 0

  return (
    <Card>
      <CardContent className="space-y-4 p-4">

        {/* ── header ───────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-card-title">Inbox scanner</h3>
            </div>
            <p className="mt-1 text-secondary-13 text-muted-foreground">
              Reads recent mail, filters the obvious noise, and checks whether
              what is left is a genuine enquiry.
              {lastScan && (
                <> Last checked <span title={absolute(lastScan)} className="underline decoration-dotted underline-offset-2">{relative(lastScan)}</span>.</>
              )}
            </p>

            {mailboxes.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-secondary-13 text-muted-foreground">Monitoring</span>
                {mailboxes.map(e => (
                  <span
                    key={e}
                    className="rounded-full bg-tint-green px-2.5 py-1.5 font-mono text-chip-12 text-foreground"
                  >
                    {e}
                  </span>
                ))}
              </div>
            )}
            {conn && mailboxes.length === 0 && (
              <p className="mt-2 text-secondary-13 text-foreground">
                No mailbox is connected yet, so there is nothing to scan.
              </p>
            )}
          </div>

          <Button size="sm" onClick={scan} disabled={busy || mailboxes.length === 0}>
            {busy
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</>
              : <><RotateCw className="h-4 w-4" /> Scan now</>}
          </Button>
        </div>

        {/* ── live phase while running ──────────────────────────────── */}
        {busy && phase && (
          <div className="flex items-center gap-2 rounded-inner border border-border bg-foreground/[0.04] px-3 py-2 text-secondary-13 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{phase}</span>
            {live.length > 0 && (
              <span className="ml-auto shrink-0 font-mono text-secondary-13 text-muted-foreground">
                {live.length} checked
              </span>
            )}
          </div>
        )}

        {/* ── the run's decisions, streaming in ─────────────────────── */}
        {live.length > 0 && (
          <div
            ref={liveRef}
            className="max-h-56 space-y-1 overflow-y-auto rounded-inner border border-border p-2"
          >
            {live.map((ev, i) => {
              if (ev.type === 'mailbox_error') {
                return (
                  <div key={i} className="flex items-start gap-2 px-1 py-1 text-secondary-13">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-red" />
                    <span className="text-foreground">
                      {ev.email} could not be read — {ev.message}
                    </span>
                  </div>
                )
              }
              if (ev.type !== 'message') return null
              const o = OUTCOME[ev.outcome]
              return (
                <div key={i} className="flex items-start gap-2 px-1 py-1 text-secondary-13">
                  <o.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${o.tone}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={`shrink-0 font-medium ${o.tone}`}>{o.label}</span>
                      {ev.subject && (
                        <span className="truncate text-muted-foreground">{ev.subject}</span>
                      )}
                    </div>
                    {ev.reason && (
                      <p className="mt-0.5 text-secondary-13 leading-snug text-muted-foreground">
                        {ev.reason}
                        {typeof ev.confidence === 'number' && (
                          <span className="ml-1 font-mono">({Math.round(ev.confidence * 100)}%)</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── outcome, stated plainly and left on screen ────────────── */}
        {fatal && (
          <div className="flex items-start gap-2 rounded-inner border border-accent-red/30 bg-tint-red px-3 py-2 text-secondary-13 text-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{fatal}</span>
          </div>
        )}

        {result && !fatal && (
          <div className="rounded-inner border border-border">
            <div className="border-b border-border px-3 py-2">
              <p className="text-secondary-13 font-medium">
                {newLeads > 0
                  ? `${newLeads} new lead${newLeads === 1 ? '' : 's'} added`
                  : 'No new leads — everything checked was accounted for'}
              </p>
            </div>
            <dl className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4">
              {[
                { k: 'Messages read',    v: result.scanned },
                { k: 'Checked this run', v: result.claimed },
                { k: 'Not enquiries',    v: result.skipped },
                { k: 'Errors',           v: result.errors },
              ].map(s => (
                <div key={s.k} className="px-3 py-2">
                  <dt className="text-secondary-13 text-muted-foreground">{s.k}</dt>
                  <dd className="font-mono text-body-15 tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>
            {result.claimed === 0 && result.scanned > 0 && (
              <p className="border-t border-border px-3 py-2 text-secondary-13 text-muted-foreground">
                Every message had already been checked by an earlier scan, so there
                was nothing new to look at. This is the normal result when scans run
                often.
              </p>
            )}
          </div>
        )}

        {/* ── the standing history ──────────────────────────────────── */}
        <div>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-1.5 text-secondary-13 font-medium text-muted-foreground hover:text-foreground"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Decision history
            {!logLoading && <span className="font-normal text-muted-foreground">({log.length})</span>}
          </button>

          {open && (
            <div className="mt-2 overflow-x-auto">
              {logLoading ? (
                <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : log.length === 0 ? (
                <p className="py-3 text-secondary-13 text-muted-foreground">
                  Nothing scanned yet. Run a scan and every decision will be recorded here.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[110px]">When</TableHead>
                      <TableHead className="w-[130px]">Outcome</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Why</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map(e => {
                      const s = STATUS[e.status] ?? STATUS.pending
                      return (
                        <TableRow key={e.id}>
                          <TableCell
                            title={absolute(e.created_at)}
                            className="whitespace-nowrap font-mono text-secondary-13 text-muted-foreground"
                          >
                            {relative(e.created_at)}
                          </TableCell>
                          <TableCell>
                            <span className={`rounded-full px-2.5 py-1.5 text-chip-12 font-medium ${s.cls}`}>
                              {s.label}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate text-secondary-13">
                            {e.subject || <span className="text-muted-foreground">—</span>}
                            {e.from_email && (
                              <span className="block truncate font-mono text-[12px] text-muted-foreground">
                                {e.from_email}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[320px] text-secondary-13 text-muted-foreground">
                            {e.error || e.reasoning || '—'}
                            {typeof e.confidence === 'number' && (
                              <span className="ml-1 font-mono">({Math.round(e.confidence * 100)}%)</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  )
}
