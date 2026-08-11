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
  lead_created:      { label: 'Lead created',   tone: 'text-emerald-700 dark:text-emerald-400', Icon: UserPlus },
  not_a_lead:        { label: 'Not a lead',     tone: 'text-zinc-500 dark:text-zinc-400',       Icon: MinusCircle },
  prefiltered:       { label: 'Filtered out',   tone: 'text-amber-700 dark:text-amber-400',     Icon: Filter },
  duplicate_sender:  { label: 'Already a lead', tone: 'text-sky-700 dark:text-sky-400',         Icon: MailCheck },
  already_processed: { label: 'Seen before',    tone: 'text-zinc-400 dark:text-zinc-500',       Icon: CheckCircle2 },
  needs_review:      { label: 'Needs review',   tone: 'text-violet-700 dark:text-violet-400',   Icon: Eye },
  error:             { label: 'Error',          tone: 'text-red-700 dark:text-red-400',         Icon: AlertTriangle },
}

const STATUS: Record<LogEntry['status'], { label: string; cls: string }> = {
  lead_created: { label: 'Lead created', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
  not_a_lead:   { label: 'Not a lead',   cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400' },
  skipped:      { label: 'Filtered',     cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  error:        { label: 'Error',        cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' },
  pending:      { label: 'In progress',  cls: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  needs_review: { label: 'Needs review', cls: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400' },
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
          else if (ev.type === 'message')  setPhase('Classifying messages…')
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
              <Inbox className="h-4 w-4 text-zinc-400 dark:text-zinc-500" />
              <h3 className="text-sm font-semibold tracking-tight">Inbox scanner</h3>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Reads recent mail, filters the obvious noise, and asks Claude whether
              what is left is a genuine enquiry.
              {lastScan && (
                <> Last checked <span title={absolute(lastScan)} className="underline decoration-dotted underline-offset-2">{relative(lastScan)}</span>.</>
              )}
            </p>

            {mailboxes.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Monitoring</span>
                {mailboxes.map(e => (
                  <span
                    key={e}
                    className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                  >
                    {e}
                  </span>
                ))}
              </div>
            )}
            {conn && mailboxes.length === 0 && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
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
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{phase}</span>
            {live.length > 0 && (
              <span className="ml-auto shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                {live.length} checked
              </span>
            )}
          </div>
        )}

        {/* ── the run's decisions, streaming in ─────────────────────── */}
        {live.length > 0 && (
          <div
            ref={liveRef}
            className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
          >
            {live.map((ev, i) => {
              if (ev.type === 'mailbox_error') {
                return (
                  <div key={i} className="flex items-start gap-2 px-1 py-1 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                    <span className="text-red-700 dark:text-red-400">
                      {ev.email} could not be read — {ev.message}
                    </span>
                  </div>
                )
              }
              if (ev.type !== 'message') return null
              const o = OUTCOME[ev.outcome]
              return (
                <div key={i} className="flex items-start gap-2 px-1 py-1 text-xs">
                  <o.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${o.tone}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className={`shrink-0 font-medium ${o.tone}`}>{o.label}</span>
                      {ev.subject && (
                        <span className="truncate text-zinc-600 dark:text-zinc-300">{ev.subject}</span>
                      )}
                    </div>
                    {ev.reason && (
                      <p className="mt-0.5 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
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
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{fatal}</span>
          </div>
        )}

        {result && !fatal && (
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <p className="text-xs font-medium">
                {newLeads > 0
                  ? `${newLeads} new lead${newLeads === 1 ? '' : 's'} added`
                  : 'No new leads — everything checked was accounted for'}
              </p>
            </div>
            <dl className="grid grid-cols-2 divide-x divide-zinc-200 sm:grid-cols-4 dark:divide-zinc-800">
              {[
                { k: 'Messages seen', v: result.scanned },
                { k: 'Newly checked', v: result.claimed },
                { k: 'Not leads',     v: result.skipped },
                { k: 'Errors',        v: result.errors },
              ].map(s => (
                <div key={s.k} className="px-3 py-2">
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">{s.k}</dt>
                  <dd className="font-mono text-sm tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>
            {result.claimed === 0 && result.scanned > 0 && (
              <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                Every message had already been checked by an earlier scan, so nothing
                was sent to Claude. This is the normal result when scans run often.
              </p>
            )}
          </div>
        )}

        {/* ── the standing history ──────────────────────────────────── */}
        <div>
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="flex w-full items-center gap-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Decision history
            {!logLoading && <span className="font-normal text-zinc-400 dark:text-zinc-500">({log.length})</span>}
          </button>

          {open && (
            <div className="mt-2 overflow-x-auto">
              {logLoading ? (
                <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : log.length === 0 ? (
                <p className="py-3 text-xs text-zinc-500 dark:text-zinc-400">
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
                            className="whitespace-nowrap font-mono text-xs text-zinc-500 dark:text-zinc-400"
                          >
                            {relative(e.created_at)}
                          </TableCell>
                          <TableCell>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                              {s.label}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[260px] truncate text-xs">
                            {e.subject || <span className="text-zinc-400 dark:text-zinc-500">—</span>}
                            {e.from_email && (
                              <span className="block truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                                {e.from_email}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[320px] text-xs text-zinc-500 dark:text-zinc-400">
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
