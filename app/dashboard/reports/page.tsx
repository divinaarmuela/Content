'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, Check, ExternalLink, FileDown, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import PageTitle from '../ui/PageTitle'
import TintCard from '../ui/TintCard'
import { useRole } from '../useRole'
import LeadsReportCard from './LeadsReportCard'
import PostBreakdowns from './PostBreakdowns'
import { readPostsExplained } from '../../lib/post-breakdown-core'
import {
  REVIEW_CHECKS, allChecked, change, fmt, monthLabel, monthRange, readReportData, recentMonths, reportHtml,
  type Breakdown, type MonthKey, type PlatformFigures, type ReportData, type TopPost,
} from '../../lib/client-report-core'

/**
 * REPORTS — THE MONTHLY CLIENT REPORT (the owner, 26 Oct 2026: "we need to build a client reporting page … we should view
 * in ui and click generate report … make it nice ui"; the team's Monthly Client Reports Guide). Pick a client and a
 * month: every figure is read from their own accounts, Claude writes the analysis, the team edits it and ticks the
 * guide's checks, then downloads the PDF. Super admins and account managers (their own clients) only.
 */

type Saved = {
  id: string; month: MonthKey; data: ReportData | null; body: string | null; objective: string | null; notes: string | null
  checks: Record<string, boolean> | null; generated_at: string | null; updated_at: string
  /** the post breakdowns (PostBreakdowns.tsx), as saved */
  posts_explained?: unknown
}
const OBJECTIVES = ['Growth', 'Engagement', 'Leads', 'Positioning']
const PREF_KEY = 'reports:last'

export default function ReportsPage() {
  const { me } = useRole()
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null)
  const [mayDelete, setMayDelete] = useState(false)
  const months = useMemo(() => recentMonths(new Date()), [])
  const [clientId, setClientId] = useState('')
  const [month, setMonth] = useState<MonthKey>(() => months[1] ?? months[0])
  const [report, setReport] = useState<Saved | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch('/api/reports/monthly').then(async r => {
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error ?? 'Reports could not be opened'); setClients([]); return }
      setClients(j.clients ?? []); setMayDelete(!!j.mayDelete)
      try { const last = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null'); if (last?.clientId && (j.clients ?? []).some((c: { id: string }) => c.id === last.clientId)) setClientId(last.clientId) } catch { /* a remembered pick is a convenience */ }
    })
  }, [])

  const load = useCallback(async (refresh = false) => {
    if (!clientId) return
    setLoading(true); setError(null)
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ clientId })) } catch { /* convenience only */ }
    try {
      const r = await fetch(`/api/reports/monthly?client_id=${encodeURIComponent(clientId)}&month=${month}${refresh ? '&refresh=1' : ''}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Could not read the figures')
      setReport(j.report ?? null)
      if (refresh) toast.success('Figures read again from the accounts')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the figures'); setReport(null) } finally { setLoading(false) }
  }, [clientId, month])
  useEffect(() => { setReport(null); void load() }, [load])

  // the saved figures with every list put back (the database keeps no empty list)
  const data = useMemo(() => readReportData(report?.data), [report?.data])
  const clientName = clients?.find(c => c.id === clientId)?.name ?? ''

  return (
    <div className="flex flex-col gap-6">
      <style>{PRINT_CSS}</style>
      <PageTitle title="Reports" summary="The monthly client report — every figure read from the client’s own accounts, the analysis drafted for you to check and finish." />

      {/* the pick */}
      <div className="no-print flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4">
        <Select value={clientId} onValueChange={v => setClientId(v)}>
          <SelectTrigger className="h-11 w-[260px] rounded-full"><SelectValue placeholder={clients === null ? 'Loading clients…' : 'Pick a client'} /></SelectTrigger>
          <SelectContent>{(clients ?? []).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={month} onValueChange={v => setMonth(v as MonthKey)}>
          <SelectTrigger className="h-11 w-[200px] rounded-full"><SelectValue /></SelectTrigger>
          <SelectContent>{months.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}{m === months[0] ? ' (so far)' : ''}</SelectItem>)}</SelectContent>
        </Select>
        {data && (
          <>
            <span className="text-[13px] text-muted-foreground">Read {new Date(data.fetchedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
            <Button variant="outline" onClick={() => void load(true)} disabled={loading} className="ml-auto h-10 gap-2 rounded-full">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Read the figures again
            </Button>
          </>
        )}
      </div>

      {error && <TintCard tone="amber" title="Something stopped the report"><p className="text-[14px]">{error}</p></TintCard>}
      {!clientId && !error && (
        <div className="no-print rounded-card border border-dashed border-border p-10 text-center">
          <p className="text-[17px] font-semibold">Pick a client and a month</p>
          <p className="mt-1 text-[14px] text-muted-foreground">The figures are read from their Instagram and Facebook, then you can generate the report.</p>
        </div>
      )}
      {clientId && loading && !data && <LoadingFigures />}

      {data && (
        <>
          {data.gaps.length > 0 && (
            <TintCard tone="amber" title="Not everything could be read">
              <ul className="list-disc pl-5 text-[14px]">{data.gaps.map(g => <li key={g}>{g}</li>)}</ul>
            </TintCard>
          )}
          {data.platforms.map(p => (
            <div key={p.platform} className="flex flex-col gap-6">
              <PlatformSection p={p} month={data.month} />
              {p.platform === 'instagram' && (
                <PostBreakdowns raw={report?.posts_explained} clientId={clientId} month={month} onChange={r => setReport(r as Saved)} />
              )}
            </div>
          ))}
          {data.audience && <AudienceSection a={data.audience} />}
          {report && <Writer report={report} clientId={clientId} month={month} mayDelete={mayDelete} onChange={setReport} onDeleted={() => void load()} />}
          <PrintReport data={data} report={report} clientName={clientName} />
        </>
      )}

      {me?.role === 'super_admin' && <div className="no-print"><LeadsReportCard /></div>}
    </div>
  )
}

/* ── the figures ─────────────────────────────────────────────────────────── */

function LoadingFigures() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-muted-foreground">Reading the month from their accounts…</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}</div>
      <Skeleton className="h-56 rounded-card" />
    </div>
  )
}

function Kpi({ label, value, was, suffix, note }: { label: string; value: number | null; was?: number | null; suffix?: string; note?: string }) {
  const c = change(value, was)
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{value == null ? '—' : `${fmt(value)}${suffix ?? ''}`}</span>
      <span className="flex min-h-5 items-center gap-1 text-[12px]">
        {c && (
          <span className={`inline-flex items-center gap-0.5 font-semibold ${c.up ? 'text-accent-green' : 'text-accent-red'}`}>
            {c.up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}{c.text}
          </span>
        )}
        <span className="text-muted-foreground">{c ? 'vs last month' : note ?? ''}</span>
      </span>
    </div>
  )
}

function PlatformSection({ p, month }: { p: PlatformFigures; month: MonthKey }) {
  const name = p.platform === 'instagram' ? 'Instagram' : 'Facebook'
  const { from, to } = monthRange(month)
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">{name}</h2>
        {p.handle && <span className="text-[14px] text-muted-foreground">@{p.handle}</span>}
        <span className="ml-auto text-[13px] text-muted-foreground">{from} to {to} · {p.posts} {p.posts === 1 ? 'post' : 'posts'}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Followers at the end of the month" value={p.followers.end} was={p.followers.previousEnd} />
        <Kpi label="Views" value={p.views} was={p.previous.views} />
        <Kpi label="Accounts reached" value={p.reach} was={p.previous.reach} />
        <Kpi label="Interactions" value={p.interactions} was={p.previous.interactions} />
        {p.platform === 'instagram' && <Kpi label="Profile visits" value={p.profileVisits} note="this month" />}
        {p.platform === 'instagram' && <Kpi label="Bio link taps" value={p.linkTaps} note="this month" />}
      </div>
      {p.viewsFromFollowers != null && p.viewsFromNonFollowers != null && (
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="mb-2 flex justify-between text-[13px]"><span>Views from followers <strong>{p.viewsFromFollowers}%</strong></span><span>from non-followers <strong>{p.viewsFromNonFollowers}%</strong></span></div>
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${p.viewsFromFollowers}% of views from followers, ${p.viewsFromNonFollowers}% from non-followers`}>
            <div className="bg-foreground" style={{ width: `${p.viewsFromFollowers}%` }} />
            <div className="bg-accent-blue" style={{ width: `${p.viewsFromNonFollowers}%` }} />
          </div>
        </div>
      )}
      {p.daily.some(d => d.views > 0) && (
        <div className="no-print rounded-card border border-border bg-surface p-4">
          <p className="mb-2 text-[13px] text-muted-foreground">Views each day</p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={p.daily} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <XAxis dataKey="date" tickFormatter={d => String(d).slice(8)} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={v => fmt(Number(v))} labelFormatter={l => new Date(String(l)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} />
                <Area type="monotone" dataKey="views" stroke="var(--dbx-blue, #2f6fed)" fill="var(--dbx-blue, #2f6fed)" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      {p.topPosts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Top {p.topPosts.length} posts by views</h3>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{p.topPosts.map((t, i) => <PostTile key={t.id} t={t} rank={i + 1} />)}</ol>
        </div>
      )}
    </section>
  )
}

function PostTile({ t, rank }: { t: TopPost; rank: number }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="relative aspect-[4/5] bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- the platform's own picture of the post */}
        {t.thumbnail && <img src={t.thumbnail} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />}
        <span className="absolute left-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-[13px] font-bold text-background">{rank}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <span className="text-[12px] text-muted-foreground">{t.publishedAt ? new Date(t.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''}{t.format ? ` · ${t.format}` : ''}</span>
        <p className="line-clamp-2 text-[13px]">{t.caption || 'No caption'}</p>
        <p className="mt-auto text-[13px]"><strong className="tabular-nums">{fmt(t.views)}</strong> views</p>
        <p className="text-[12px] text-muted-foreground tabular-nums">{fmt(t.likes)} likes · {fmt(t.comments)} comments · {fmt(t.shares)} shares · {fmt(t.saves)} saves</p>
        {t.url && <a href={t.url} target="_blank" rel="noreferrer" className="no-print inline-flex items-center gap-1 text-[12px] underline underline-offset-4">Open <ExternalLink className="h-3 w-3" aria-hidden /></a>}
      </div>
    </li>
  )
}

function Bars({ title, rows }: { title: string; rows: Breakdown[] }) {
  if (!rows.length) return null
  const max = Math.max(...rows.map(r => r.pct), 1)
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="mb-3 text-[13px] font-semibold">{title}</p>
      <ul className="flex flex-col gap-2">
        {rows.map(r => (
          <li key={r.label} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2 text-[13px]">
            <span className="truncate" title={r.label}>{r.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground" style={{ width: `${(r.pct / max) * 100}%` }} /></span>
            <span className="text-right tabular-nums text-muted-foreground">{r.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AudienceSection({ a }: { a: NonNullable<ReportData['audience']> }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-2">
        <h2 className="text-[20px] font-semibold">Audience</h2>
        <span className="text-[13px] text-muted-foreground">Instagram followers{a.asOf ? ` · as of ${new Date(a.asOf).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}</span>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title="Age" rows={a.age} />
        <Bars title="Top cities" rows={a.cities} />
      </div>
      {a.engaged && (
        <>
          <p className="mt-2 text-[14px] font-semibold">Who engaged this month <span className="font-normal text-muted-foreground">— the people who liked, commented, shared or saved, not just followers</span></p>
          <div className="grid gap-3 md:grid-cols-2">
            <Bars title="Age" rows={a.engaged.age} />
            <Bars title="Top cities" rows={a.engaged.cities} />
          </div>
        </>
      )}
    </section>
  )
}

/* ── the written report ──────────────────────────────────────────────────── */

function Writer({ report, clientId, month, mayDelete, onChange, onDeleted }: {
  report: Saved; clientId: string; month: MonthKey; mayDelete: boolean; onChange: (r: Saved) => void; onDeleted: () => void
}) {
  const [objective, setObjective] = useState(report.objective || 'Growth')
  const [notes, setNotes] = useState(report.notes ?? '')
  const [body, setBody] = useState(report.body ?? '')
  const [editing, setEditing] = useState(false)
  const [writing, setWriting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState<'regen' | 'delete' | null>(null)
  useEffect(() => { setBody(report.body ?? ''); setNotes(report.notes ?? ''); setObjective(report.objective || 'Growth') }, [report.id, report.generated_at]) // eslint-disable-line react-hooks/exhaustive-deps
  const checks = report.checks ?? {}
  const dirty = body !== (report.body ?? '')

  const patch = async (fields: Record<string, unknown>) => {
    const r = await fetch('/api/reports/monthly', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, month, ...fields }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? 'Could not save')
    onChange(j.report)
  }
  const generate = async () => {
    setAsking(null); setWriting(true)
    try {
      const r = await fetch('/api/reports/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, month, action: 'generate', objective, notes }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Could not write the report')
      onChange(j.report); setEditing(false)
      toast.success('Report written — read it through, edit, and tick the checks')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not write the report') } finally { setWriting(false) }
  }
  const saveBody = async () => {
    setSaving(true)
    try { await patch({ body, notes, objective }); setEditing(false); toast.success('Saved') } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save') } finally { setSaving(false) }
  }
  const tick = async (key: string, v: boolean) => { try { await patch({ checks: { ...checks, [key]: v } }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save') } }
  const remove = async () => {
    setAsking(null)
    const r = await fetch(`/api/reports/monthly?client_id=${encodeURIComponent(clientId)}&month=${month}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error ?? 'Could not delete'); return }
    toast.success('Report deleted'); onDeleted()
  }

  return (
    <section className="no-print flex flex-col gap-4 rounded-card border border-border bg-surface p-5">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-[20px] font-semibold">The report</h2>
        {report.body && <span className="text-[13px] text-muted-foreground">Written {report.generated_at ? new Date(report.generated_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span>}
        {mayDelete && report.body && (
          <Button variant="ghost" onClick={() => setAsking('delete')} className="h-10 gap-1.5 rounded-full text-destructive"><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
        )}
      </header>

      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Objective
          <Select value={objective} onValueChange={setObjective}>
            <SelectTrigger className="h-11 rounded-full"><SelectValue /></SelectTrigger>
            <SelectContent>{OBJECTIVES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold">Your notes for the report (optional)
          <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} className="rounded-[18px] font-normal"
            placeholder="What you think worked or didn’t, pillars you want next month, anything about the client the numbers don’t show." />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => (report.body ? setAsking('regen') : void generate())} disabled={writing} className="h-11 gap-2 rounded-full px-5">
          <Sparkles className={`h-4 w-4 ${writing ? 'animate-pulse' : ''}`} aria-hidden /> {writing ? 'Writing the report…' : report.body ? 'Generate again' : 'Generate report'}
        </Button>
        {writing && <span className="text-[13px] text-muted-foreground">Claude is reading the month — this takes a minute or two.</span>}
      </div>

      {report.body ? (
        <>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button onClick={() => void saveBody()} disabled={saving || !dirty} className="h-10 rounded-full">{saving ? 'Saving…' : 'Save'}</Button>
                <Button variant="outline" onClick={() => { setBody(report.body ?? ''); setEditing(false) }} className="h-10 rounded-full">Cancel</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setEditing(true)} className="h-10 gap-1.5 rounded-full"><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
            )}
          </div>
          {editing
            ? <Textarea value={body} onChange={e => setBody(e.target.value)} rows={28} className="rounded-[18px] font-mono text-[13px]" aria-label="The report" />
            : <article className="report-prose rounded-inner border border-border bg-background p-6" dangerouslySetInnerHTML={{ __html: reportHtml(report.body) }} />}

          <div className="flex flex-col gap-2 rounded-inner bg-muted/40 p-4">
            <p className="text-[14px] font-semibold">Before it goes to the client</p>
            {REVIEW_CHECKS.map(c => (
              <label key={c.key} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-[14px]">
                <input type="checkbox" className="h-4 w-4 accent-foreground" checked={checks[c.key] === true} onChange={e => void tick(c.key, e.target.checked)} />
                {c.words}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => window.print()} disabled={editing} className="h-11 gap-2 rounded-full px-5"><FileDown className="h-4 w-4" aria-hidden /> Download PDF</Button>
            {allChecked(checks)
              ? <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent-green"><Check className="h-4 w-4" aria-hidden /> Every check ticked</span>
              : <span className="text-[13px] text-muted-foreground">Tick every check before it goes to the client. In the print window, choose “Save as PDF”.</span>}
          </div>
        </>
      ) : !writing && (
        <p className="text-[14px] text-muted-foreground">No report yet. Add your notes if you have any, then press Generate report — every figure above goes in, exactly as read.</p>
      )}

      <AlertDialog open={asking !== null} onOpenChange={o => { if (!o) setAsking(null) }}>
        <AlertDialogContent className="bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>{asking === 'delete' ? 'Delete this report?' : 'Write the report again?'}</AlertDialogTitle>
            <AlertDialogDescription>{asking === 'delete'
              ? 'The written report and its ticks are removed. The figures can be read again at any time.'
              : 'The current text, with any edits, is replaced by a new draft, and the checks are cleared.'}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void (asking === 'delete' ? remove() : generate())}>{asking === 'delete' ? 'Delete' : 'Write again'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

/** the post breakdowns in the PDF: each post's score and the one-line verdict */
function PrintBreakdowns({ raw }: { raw: unknown }) {
  const x = readPostsExplained(raw)
  const items = (x?.items ?? []).filter(i => i.breakdown)
  if (!items.length) return null
  const byId = new Map((x?.posts ?? []).map(p => [p.id, p]))
  return (
    <>
      <h3>Why the posts worked</h3>
      {items.map(i => {
        const p = byId.get(i.postId)
        return (
          <p key={i.postId} className="pr-small">
            <strong>{p?.publishedAt ? new Date(p.publishedAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : ''} · score {i.index.score} ({i.index.multiple}× a typical post).</strong> {i.breakdown!.verdict}
          </p>
        )
      })}
    </>
  )
}

/* ── the PDF: the print view — the figures, the top posts, the audience and the report ── */

function PrintReport({ data, report, clientName }: { data: ReportData; report: Saved | null; clientName: string }) {
  return (
    <div id="report-print" aria-hidden>
      <div className="pr-cover">
        <p className="pr-kicker">MD Media · Monthly report</p>
        <h1>{clientName}</h1>
        <p className="pr-month">{monthLabel(data.month)}</p>
      </div>
      {data.platforms.map(p => (
        <div key={p.platform} className="pr-block">
          <h2>{p.platform === 'instagram' ? 'Instagram' : 'Facebook'}{p.handle ? ` · @${p.handle}` : ''}</h2>
          <table className="pr-kpis">
            <tbody>
              {([
                ['Followers', p.followers.end, p.followers.previousEnd],
                ['Views', p.views, p.previous.views],
                ['Accounts reached', p.reach, p.previous.reach],
                ['Interactions', p.interactions, p.previous.interactions],
                ...(p.platform === 'instagram' ? [['Profile visits', p.profileVisits, null], ['Bio link taps', p.linkTaps, null]] as const : []),
              ] as [string, number | null, number | null][]).map(([l, v, w]) => (
                <tr key={l}><td>{l}</td><td className="pr-num">{fmt(v)}</td><td className="pr-chg">{w != null ? (change(v, w)?.text ?? '') : ''}{w != null ? ` (last month ${fmt(w)})` : ''}</td></tr>
              ))}
              {p.viewsFromFollowers != null && <tr><td>Views from followers / non-followers</td><td className="pr-num">{p.viewsFromFollowers}% / {p.viewsFromNonFollowers}%</td><td /></tr>}
            </tbody>
          </table>
          {p.topPosts.length > 0 && (
            <>
              <h3>Top posts by views</h3>
              <div className="pr-posts">
                {p.topPosts.map((t, i) => (
                  <div key={t.id} className="pr-post">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {t.thumbnail && <img src={t.thumbnail} alt="" referrerPolicy="no-referrer" />}
                    <p><strong>{i + 1}. {fmt(t.views)} views</strong></p>
                    <p className="pr-small">{fmt(t.likes)} likes · {fmt(t.comments)} comments · {fmt(t.shares)} shares</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {p.platform === 'instagram' && <PrintBreakdowns raw={report?.posts_explained} />}
        </div>
      ))}
      {data.audience && (
        <div className="pr-block">
          <h2>Audience</h2>
          <p className="pr-small">Age: {data.audience.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
          <p className="pr-small">Top cities: {data.audience.cities.slice(0, 5).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>
          {data.audience.engaged && <p className="pr-small">Who engaged this month: {data.audience.engaged.age.slice(0, 4).map(b => `${b.label} ${b.pct}%`).join(' · ')}</p>}
        </div>
      )}
      {report?.body && <div className="pr-block report-prose" dangerouslySetInnerHTML={{ __html: reportHtml(report.body) }} />}
    </div>
  )
}

const PRINT_CSS = `
.report-prose h2{font-size:20px;font-weight:600;margin:22px 0 8px}
.report-prose h3{font-size:16px;font-weight:600;margin:18px 0 6px}
.report-prose h4{font-size:14px;font-weight:600;margin:14px 0 4px}
.report-prose p{font-size:14px;line-height:1.65;margin:0 0 10px}
.report-prose ul,.report-prose ol{margin:0 0 12px;padding-left:22px;font-size:14px;line-height:1.6}
.report-prose ul{list-style:disc}.report-prose ol{list-style:decimal}
.report-prose li{margin:3px 0}
.report-prose table{width:100%;border-collapse:collapse;margin:8px 0 14px;font-size:13px}
.report-prose th,.report-prose td{border:1px solid var(--border,#ddd);padding:6px 8px;text-align:left}
#report-print{display:none}
@media print{
  @page{size:A4;margin:16mm}
  body *{visibility:hidden}
  #report-print,#report-print *{visibility:visible}
  #report-print{display:block;position:absolute;left:0;top:0;width:100%;color:#0a0a0a;background:#fff;font-family:inherit}
  .pr-cover{border-bottom:3px solid #0a0a0a;padding-bottom:18px;margin-bottom:22px}
  .pr-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#666;margin:0}
  .pr-cover h1{font-size:34px;font-weight:700;margin:6px 0 2px}
  .pr-month{font-size:16px;color:#444;margin:0}
  .pr-block{margin:0 0 22px;break-inside:avoid-page}
  .pr-block h2{font-size:18px;font-weight:600;margin:0 0 8px}
  .pr-block h3{font-size:14px;font-weight:600;margin:12px 0 6px}
  .pr-kpis{width:100%;border-collapse:collapse;font-size:13px}
  .pr-kpis td{border-bottom:1px solid #e5e5e5;padding:6px 4px}
  .pr-num{font-weight:700;text-align:right;white-space:nowrap}
  .pr-chg{color:#666;font-size:12px;padding-left:10px}
  .pr-posts{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
  .pr-post img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px}
  .pr-post p{margin:4px 0 0;font-size:11px}
  .pr-small{font-size:11px;color:#555}
}
`
