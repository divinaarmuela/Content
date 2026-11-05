'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, Check, CircleHelp, ExternalLink, FileDown, Pencil, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import PageTitle from '../ui/PageTitle'
import TintCard from '../ui/TintCard'
import PostBreakdowns from './PostBreakdowns'
import PostsInReport from './PostsInReport'
import { AudienceSection, PlatformSection } from './ReportFigures'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { readPostsExplained } from '../../lib/post-breakdown-core'
import {
  FRESHNESS, REVIEW_CHECKS, allChecked, change, fmt, melbourneDay, monthLabel, monthRange, monthState, readReportData, recentMonths, reportHtml,
  type Breakdown, type MonthKey, type MonthState, type PlatformFigures, type ReportData, type TopPost, readHistory, type ReportVersion, includedIds, type CandidatePost, includedPlatforms, scopeData, platformLabel, writtenFromOldFigures, availableStats } from '../../lib/client-report-core'

/**
 * REPORTS — THE MONTHLY CLIENT REPORT (the owner, 26 Oct 2026: "we need to build a client reporting page … we should view
 * in ui and click generate report … make it nice ui"; the team's Monthly Client Reports Guide). Pick a client and a
 * month: every figure is read from their own accounts, the AI drafts the analysis, the team edits it and ticks the
 * guide's checks, then downloads the PDF. Super admins and account managers (their own clients) only.
 */

type Saved = {
  id: string; month: MonthKey; data: ReportData | null; body: string | null; objective: string | null; notes: string | null
  checks: Record<string, boolean> | null; generated_at: string | null; updated_at: string
  generated_by?: string | null; updated_by?: string | null; explained_by?: string | null; history?: unknown
  /** the post breakdowns (PostBreakdowns.tsx), as saved */
  posts_explained?: unknown
  /** the posts the team ticked for this report (PostsInReport.tsx) */
  included_post_ids?: unknown
  /** the accounts ticked for this report (5 Nov 2026) */
  included_platforms?: unknown
  /** on the client's portal since (5 Nov 2026) */
  shared_at?: string | null; shared_by?: string | null
  written_v?: number | null
}
const OBJECTIVES = ['Growth', 'Engagement', 'Leads', 'Positioning']
const PREF_KEY = 'reports:last'

export default function ReportsPage() {
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null)
  const [mayDelete, setMayDelete] = useState(false)
  const months = useMemo(() => recentMonths(new Date()), [])
  const [clientId, setClientId] = useState('')
  const [month, setMonth] = useState<MonthKey>(() => months[1] ?? months[0])
  const [report, setReport] = useState<Saved | null>(null)
  /** id → name, for who wrote, edited and explained */
  const [people, setPeople] = useState<Record<string, string>>({})
  /** where the client reads it: their portal's Reports tab (null: the client is not on the one portal) */
  const [portalLink, setPortalLink] = useState<string | null>(null)
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
      if (j.people) setPeople(j.people)
      setPortalLink(typeof j.portalLink === 'string' ? j.portalLink : null)
      if (refresh) toast.success('Figures read again from the accounts')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the figures'); setReport(null) } finally { setLoading(false) }
  }, [clientId, month])
  useEffect(() => { setReport(null); void load() }, [load])

  // the saved figures with every list put back (the database keeps no empty list)
  const data = useMemo(() => readReportData(report?.data), [report?.data])
  const clientName = clients?.find(c => c.id === clientId)?.name ?? ''
  // where the month stands: still running (nothing compared), settling (Instagram still sending), or final
  const state = useMemo(() => monthState(month, melbourneDay(new Date()), data?.fetchedAt), [month, data?.fetchedAt])

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
          </>
        )}
        <HowItWorks />
        {data && (
          <>
            <Button variant="outline" onClick={() => void load(true)} disabled={loading} className="h-10 gap-2 rounded-full">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Read the figures again
            </Button>
          </>
        )}
      </div>

      {error && <TintCard tone="amber" title="Something stopped the report"><p className="text-[14px]">{error}</p></TintCard>}
      {!clientId && !error && (
        <div className="no-print rounded-card border border-dashed border-border p-10 text-center">
          <p className="text-[17px] font-semibold">Pick a client and a month</p>
          <ol className="mx-auto mt-3 flex max-w-[640px] flex-wrap justify-center gap-x-5 gap-y-1 text-[14px] text-muted-foreground">
            {['Pick the client and month', 'Check the numbers', 'Generate the report', 'Read it, edit, tick the checks', 'Download the PDF'].map((w, i) => (
              <li key={w}><strong className="text-foreground">{i + 1}</strong> {w}</li>
            ))}
          </ol>
        </div>
      )}
      {clientId && loading && !data && <LoadingFigures />}

      {data && (
        <>
          <FreshnessCard state={state} month={data.month} fetchedAt={data.fetchedAt} />
          {data.gaps.length > 0 && (
            <TintCard tone="amber" title="Not everything could be read">
              <ul className="list-disc pl-5 text-[14px]">{data.gaps.map(g => <li key={g}>{g}</li>)}</ul>
            </TintCard>
          )}
          {data.platforms.map(p => (
            <div key={p.platform} className="flex flex-col gap-6">
              <PlatformSection p={p} month={data.month} running={state.kind === 'running'} avail={(data.candidates?.length ? availableStats(data.candidates) : null)} />
            </div>
          ))}
          {data.audience && <AudienceSection a={data.audience} />}
          {/* WHY THE POSTS WORKED, RIGHT ABOVE THE REPORT (the owner, 4 Nov 2026: "one button … make sure explain the
              posts is shown as well near the report so it's nice and clear") — filled by Build report, no button of its own */}
          {data.platforms.some(p => p.platform === 'instagram') && (
            <PostBreakdowns raw={report?.posts_explained} clientId={clientId} month={month} onChange={r => setReport(r as Saved)} noButton
              explainedBy={report?.explained_by ? people[String(report.explained_by)] ?? null : null} />
          )}
          {report && <Writer report={report} clientId={clientId} month={month} mayDelete={mayDelete} onChange={setReport} onDeleted={() => void load()}
            settled={state.kind === 'final'} settlesOn={state.settlesOn} people={people} candidates={data.candidates ?? []} portalLink={portalLink}
            connected={data.platforms.map(p => p.platform)} />}
          <PrintReport data={scopeData(data, includedPlatforms(report?.included_platforms, data.platforms.map(p => p.platform)))} report={report} clientName={clientName} />
        </>
      )}
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

/** HOW UP TO DATE THIS IS: said on the page, not left to be guessed (the owner, 2 Nov 2026) */
function FreshnessCard({ state, month, fetchedAt }: { state: MonthState; month: MonthKey; fetchedAt: string }) {
  const name = monthLabel(month).split(' ')[0]
  const on = new Date(`${state.settlesOn}T00:00:00`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  const read = new Date(fetchedAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  const [tone, title, words] =
    state.kind === 'running' ? ['blue', `${name} is still running`, `These are the numbers so far, so nothing is compared with last month yet. The month’s final numbers are in from ${on}.`] as const
    : state.kind === 'settling' ? ['amber', `${name} has just ended. Its numbers are still coming in`, `Instagram sends the last days of a month late. Press “Read the figures again” on or after ${on} for the final numbers.`] as const
    : state.readEarly ? ['amber', 'Read before the month’s numbers were complete', `These figures were read ${read}, before ${on}. Press “Read the figures again” for the final numbers.`] as const
    : ['green', `${name}’s numbers are final`, `Read ${read}, after the month’s numbers were complete.`] as const
  return (
    <TintCard tone={tone} title={title}>
      <p className="text-[14px]">{words}</p>
      <details className="mt-2 text-[13px]">
        <summary className="cursor-pointer font-semibold">How up to date each number is</summary>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {FRESHNESS.map(f => <li key={f.what}><strong>{f.what}</strong>: {f.how}</li>)}
          <li>All of it is read straight from Instagram and Facebook.</li>
        </ul>
      </details>
    </TintCard>
  )
}

/* ── the written report ──────────────────────────────────────────────────── */

function Writer({ report, clientId, month, mayDelete, onChange, onDeleted, settled, settlesOn, people, candidates: allCandidates, portalLink, connected }: {
  report: Saved; clientId: string; month: MonthKey; mayDelete: boolean; onChange: (r: Saved) => void; onDeleted: () => void
  /** the month's numbers are complete (2 days after it ends) — building before that is allowed, but said */
  settled: boolean; settlesOn: string
  people: Record<string, string>
  /** the month's posts, for the Build report popup's "these posts are included" */
  candidates: CandidatePost[]
  portalLink: string | null
  /** the accounts connected — the ones that can be ticked */
  connected: string[]
}) {
  const platformsOn = includedPlatforms(report.included_platforms, connected)
  const candidates = allCandidates.filter(c => platformsOn.has(c.platform))
  const togglePlatform = (pl: string) => {
    const next = new Set(platformsOn)
    if (next.has(pl)) next.delete(pl); else next.add(pl)
    if (next.size === 0) { toast.error('Keep at least one account in the report'); return }
    void patch({ included_platforms: [...next] }).catch(e => toast.error(e instanceof Error ? e.message : 'Could not save'))
  }
  // ONE THING (the owner, 5 Nov 2026: "why are there two things"): Build report opens a popup with the posts that are
  // included, more can be ticked in there, and its button builds the report
  const [picking, setPicking] = useState(false)
  const pickedCount = includedIds(report.included_post_ids, candidates).size
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
  const [sharing, setSharing] = useState(false)
  const share = async (on: boolean) => {
    setSharing(true)
    try { await patch({ share: on }); toast.success(on ? 'On the client’s portal now' : 'Taken off their portal') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save') }
    finally { setSharing(false) }
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
  /**
   * BUILD REPORT, ONE PRESS (the owner, 4 Nov 2026: "how to build a better system" — option 1). The three steps that
   * had to be pressed in the right order, by hand: read the figures fresh, explain the posts, write the report. Each
   * step's answer is kept as it lands; a step that fails is said and the rest still run where they can — the posts
   * not explained (no Instagram, too few posts) still leaves a report written from the figures.
   */
  const [building, setBuilding] = useState<string | null>(null)
  /** THE BUILD, STEP BY STEP (the owner, 5 Nov 2026: "make sure the loading shows nicely the status when generating") */
  const [steps, setSteps] = useState<BuildStep[] | null>(null)
  const mark = (i: number, state: BuildStep['state'], note?: string) =>
    setSteps(cur => cur && cur.map((s, k) => (k === i ? { ...s, state, note: note ?? s.note, ...(state === 'run' ? { from: Date.now() } : { to: Date.now() }) } : s)))
  const build = async () => {
    setSteps(BUILD_STEPS.map(s => ({ ...s, state: 'wait' as const })))
    setAsking(null)
    const call = async (url: string, init?: RequestInit) => {
      const r = await fetch(url, init)
      const j = await r.json().catch(() => ({}))
      return { ok: r.ok, j }
    }
    const notesText = notes
    const problems: string[] = []
    try {
      setBuilding('Reading the figures fresh…'); mark(0, 'run')
      const fresh = await call(`/api/reports/monthly?client_id=${encodeURIComponent(clientId)}&month=${month}&refresh=1`)
      if (!fresh.ok) throw new Error(fresh.j.error ?? 'Could not read the figures')
      if (fresh.j.report) onChange(fresh.j.report)
      mark(0, 'done')

      setBuilding('Explaining the posts — reading 90 days of Instagram…'); mark(1, 'run')
      const post = (body: Record<string, unknown>) => call('/api/reports/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: clientId, month, ...body }) })
      const ex = await post({ action: 'explain' })
      if (ex.ok) { if (ex.j.report) onChange(ex.j.report); mark(1, 'done') } else { problems.push(`posts not explained (${ex.j.error ?? 'failed'})`); mark(1, 'skip', ex.j.error ?? 'Could not explain them — the report is still written') }

      setBuilding('Writing the report — a minute or two…'); mark(2, 'run')
      const gen = await post({ action: 'generate', objective, notes: notesText })
      if (!gen.ok) throw new Error(gen.j.error ?? 'Could not write the report')
      mark(2, 'done')
      onChange(gen.j.report); setEditing(false)
      setTimeout(() => setSteps(null), 8000)
      toast.success(problems.length ? `Report built — ${problems.join('; ')}. Read it through and tick the checks.` : 'Report built — figures fresh, posts explained, report written. Read it through and tick the checks.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build the report')
      setSteps(cur => cur && cur.map(s => (s.state === 'run' ? { ...s, state: 'fail' as const, to: Date.now(), note: e instanceof Error ? e.message : 'Failed' } : s)))
    } finally {
      setBuilding(null)
    }
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
        {report.body && <span className="text-[13px] text-muted-foreground">{stampLine(report, people)}</span>}
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
        <Button onClick={() => (candidates.length ? setPicking(true) : report.body ? setAsking('regen') : void build())} disabled={writing || !!building} className="h-11 gap-2 rounded-full px-5">
          <Sparkles className={`h-4 w-4 ${building ? 'animate-pulse' : ''}`} aria-hidden /> {building ? 'Building…' : report.body ? 'Build again' : 'Build report'}
        </Button>
        {!building && !settled && (
          <span className="text-[13px] text-muted-foreground">
            This month’s numbers are not final until {new Date(`${settlesOn}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} — build again then for the final report.
          </span>
        )}
      </div>

      {steps && <BuildProgress steps={steps} />}

      {writtenFromOldFigures(report) && !building && (
        <div className="rounded-inner border border-accent-amber/40 bg-tint-amber p-4" role="alert">
          <p className="text-[15px] font-semibold">Written from figures we have since corrected</p>
          <p className="mt-1 text-[13px]">
            This report was written before the follower counts and the comparisons with last month were fixed (5 Nov 2026), so numbers in the text may be wrong.
            Press <strong>Build again</strong> so the text matches the figures above. Your current text is kept under Earlier versions. It cannot be shared with the client until then.
          </p>
        </div>
      )}

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
          <EarlierVersions history={readHistory(report.history)} people={people} />

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
          {/* ON THE CLIENT'S PORTAL (Manal, via the owner, 5 Nov 2026): the client reads it, interactive, in their
              portal's Reports tab. Nothing is emailed: the team sends the link themselves. */}
          <div className="flex flex-col gap-2 rounded-inner border border-border p-4">
            <p className="text-[15px] font-semibold">On the client’s portal</p>
            {!portalLink ? (
              <p className="text-[13px] text-muted-foreground">This client is not on the client portal yet, so there is nowhere to share it.</p>
            ) : report.shared_at ? (
              <>
                <p className="text-[13px] text-muted-foreground">
                  Shared{report.shared_by ? ` by ${people[String(report.shared_by)] ?? 'someone'}` : ''} · {new Date(report.shared_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.
                  The client sees it in the Reports tab of their portal. Edits you save show there too.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => { void navigator.clipboard.writeText(`${window.location.origin}${portalLink}`).then(() => toast.success('Link copied — paste it to the client')).catch(() => toast.error('Could not copy')) }} className="h-10 rounded-full">Copy the client’s link</Button>
                  <Button variant="outline" onClick={() => window.open(portalLink, '_blank', 'noopener')} className="h-10 gap-1.5 rounded-full">See what they see <ExternalLink className="h-4 w-4" aria-hidden /></Button>
                  <Button variant="ghost" disabled={sharing} onClick={() => void share(false)} className="h-10 rounded-full text-destructive">Take it off their portal</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground">When it is ready, share it: it shows in their portal’s Reports tab, with their accounts and posts to click through. Nothing is emailed.</p>
                <div>
                  <Button disabled={sharing || !allChecked(checks) || editing || writtenFromOldFigures(report)} onClick={() => void share(true)} className="h-10 rounded-full">Share with client</Button>
                  {writtenFromOldFigures(report)
                    ? <span className="ml-3 text-[13px] text-muted-foreground">Build it again first: it was written from old figures.</span>
                    : !allChecked(checks) && <span className="ml-3 text-[13px] text-muted-foreground">Tick every check first.</span>}
                </div>
              </>
            )}
          </div>
        </>
      ) : !writing && (
        <p className="text-[14px] text-muted-foreground">Press Build report. It shows the posts that are included, you can add more, then it builds the report.</p>
      )}

      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="max-h-[90vh] overflow-y-auto bg-popover sm:max-w-[960px]">
          <DialogHeader>
            <DialogTitle>{report.body ? 'Build the report again' : 'Build the report'}</DialogTitle>
            <DialogDescription>These posts are included. Click a post to add it or take it out, then press the button at the bottom.</DialogDescription>
          </DialogHeader>
          {/* THE ACCOUNTS (5 Nov 2026): Instagram and Facebook start on; TikTok and LinkedIn when connected and ticked.
              What is on here is what the report, the PDF and the client's portal show. */}
          <div className="flex flex-col gap-2">
            <p className="text-[15px] font-semibold">Accounts in this report</p>
            <div className="flex flex-wrap gap-2">
              {connected.map(pl => {
                const on = platformsOn.has(pl)
                return (
                  <button key={pl} type="button" aria-pressed={on} onClick={() => togglePlatform(pl)}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition ${on ? 'border-foreground bg-foreground text-background' : 'border-border hover:bg-muted'}`}>
                    {on ? <Check className="h-4 w-4" aria-hidden /> : <span className="h-4 w-4 rounded-full border border-current opacity-50" aria-hidden />}
                    {platformLabel(pl)}
                  </button>
                )
              })}
            </div>
            <p className="text-[12px] text-muted-foreground">Only the ticked accounts go in the written report, the PDF and the client’s portal.</p>
          </div>
          <PostsInReport candidates={candidates} saved={report.included_post_ids} clientId={clientId} month={month} onChange={r => onChange(r as Saved)} />
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-popover px-6 py-4">
            {report.body && <span className="mr-auto text-[13px] text-muted-foreground">The current report is kept under Earlier versions.</span>}
            <Button variant="ghost" onClick={() => setPicking(false)} className="h-11 rounded-full">Cancel</Button>
            <Button disabled={pickedCount === 0} onClick={() => { setPicking(false); void build() }} className="h-11 gap-2 rounded-full px-5">
              <Sparkles className="h-4 w-4" aria-hidden /> Build report with {pickedCount} post{pickedCount === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
            <AlertDialogAction onClick={() => void (asking === 'delete' ? remove() : build())}>{asking === 'delete' ? 'Delete' : 'Build again'}</AlertDialogAction>
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
            {p?.url && <> <a href={p.url}>See the post</a></>}
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
          <h2>{platformLabel(p.platform)}{p.handle ? ` · @${p.handle}` : ''}</h2>
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
                    {t.thumbnail && (t.url ? <a href={t.url}><img src={t.thumbnail} alt="" referrerPolicy="no-referrer" /></a> : <img src={t.thumbnail} alt="" referrerPolicy="no-referrer" />)}
                    <p><strong>{i + 1}. {fmt(t.views)} views</strong></p>
                    <p className="pr-small">{fmt(t.likes)} likes · {fmt(t.comments)} comments · {fmt(t.shares)} shares</p>
                    {t.url && <p className="pr-small"><a href={t.url}>See the post</a></p>}
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
.report-prose a,#report-print a{color:#2f6fed;text-decoration:underline;text-underline-offset:3px}
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

/** when and who: "Written by Manal · 4 Nov, 6:10 pm · last edited by Karly · 4 Nov, 6:40 pm" */
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
function stampLine(r: Saved, people: Record<string, string>): string {
  const name = (id: unknown) => (id ? people[String(id)] ?? 'someone' : 'someone')
  const written = r.generated_at ? `Written by ${name(r.generated_by)} · ${when(r.generated_at)}` : ''
  const edited = r.updated_at && r.generated_at && r.updated_at > r.generated_at && r.updated_by ? ` · last edited by ${name(r.updated_by)} · ${when(r.updated_at)}` : ''
  return written + edited
}

/** EVERY EARLIER VERSION, kept and readable (the owner, 4 Nov 2026: "please don't overwrite current reports") */
function EarlierVersions({ history, people }: { history: ReportVersion[]; people: Record<string, string> }) {
  if (history.length === 0) return null
  const name = (id: string | null) => (id ? people[id] ?? 'someone' : 'someone')
  return (
    <details className="rounded-inner border border-border bg-surface p-3">
      <summary className="cursor-pointer text-[14px] font-semibold">Earlier versions ({history.length})</summary>
      <ol className="mt-3 flex flex-col gap-2">
        {history.map((v, i) => (
          <li key={`${v.replaced_at}-${i}`}>
            <details className="rounded-inner border border-border p-3">
              <summary className="cursor-pointer text-[13px]">
                Written by {name(v.written_by)} · {when(v.written_at)}
                {v.edited_at && v.edited_by && v.written_at && v.edited_at > v.written_at ? ` · edited by ${name(v.edited_by)} · ${when(v.edited_at)}` : ''}
                <span className="text-muted-foreground"> — replaced by {name(v.replaced_by)} · {when(v.replaced_at)}</span>
              </summary>
              <div className="mt-2 flex justify-end">
                <Button variant="outline" size="sm" className="h-8 rounded-full text-[12px]"
                  onClick={() => { void navigator.clipboard.writeText(v.body).then(() => toast.success('Copied')).catch(() => toast.error('Could not copy')) }}>
                  Copy this version
                </Button>
              </div>
              <article className="report-prose mt-2 max-h-[480px] overflow-y-auto rounded-inner border border-border bg-background p-4" dangerouslySetInnerHTML={{ __html: reportHtml(v.body) }} />
            </details>
          </li>
        ))}
      </ol>
    </details>
  )
}

/**
 * HOW THIS REPORT WORKS (the owner, 5 Nov 2026: "add an explainer how this is gathering info so the team know how this
 * report works"). Plain words, closed until opened, never printed.
 */
function HowItWorks() {
  const [open, setOpen] = useState(false)
  const steps: { title: string; body: string }[] = [
    { title: '1. The figures are read from the client’s own accounts',
      body: 'Every number comes from the client’s connected Instagram and Facebook. Nothing is typed in by hand and nothing is posted or changed — it only reads. “Read the figures again” fetches them fresh.' },
    { title: '2. The month is not final straight away',
      body: 'Instagram keeps counting views and reach for a couple of days after a post goes out, so a month’s numbers settle 2 days after it ends. Build it before then and the report says so — build it again after for the final numbers.' },
    { title: 'Which posts the report is about',
      body: 'Under “Posts in this report”, the posts MD Media published are ticked to start. Tick any other post from the month to add it, or untick one to leave it out. The explanations and the written report are about the ticked posts; the account totals stay as context.' },
    { title: '3. The posts are explained',
      body: 'Every Instagram post of the month is compared with the account’s own last 90 days — not other accounts. The 5 best and up to 3 that fell behind are picked, and the AI looks at each one (the picture, the caption and the numbers) and says why it did well or fell behind.' },
    { title: '4. The report is written',
      body: 'The AI writes the report from the figures above, the post explanations, and the objective and notes you give it. It only uses these numbers — it does not look anything up elsewhere.' },
    { title: '5. A person checks it',
      body: 'The AI draft is a starting point. Read it, fix anything that sounds wrong, tick the checks, then download the PDF. Nothing is ever sent to the client from here.' },
    { title: 'Nothing is lost',
      body: 'Building again or editing keeps the old version under “Earlier versions”, with who wrote it and when. The page also shows who last explained the posts and who last edited the report.' },
  ]
  return (
    <>
    <Button variant="ghost" onClick={() => setOpen(true)} className="ml-auto h-10 gap-2 rounded-full">
      <CircleHelp className="h-4 w-4" aria-hidden /> How this report works
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85vh] overflow-y-auto bg-popover sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>How this report works</DialogTitle>
          <DialogDescription>
            One press of <strong className="text-foreground">Build report</strong> does steps 1, 3 and 4 in order. Here is where everything comes from.
          </DialogDescription>
        </DialogHeader>
      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map(st => (
          <li key={st.title} className="rounded-inner border border-border bg-background p-3">
            <p className="text-[14px] font-semibold">{st.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{st.body}</p>
          </li>
        ))}
      </ol>
      </DialogContent>
    </Dialog>
    </>
  )
}

/* ── BUILD REPORT, STEP BY STEP ─────────────────────────────────────────── */
type BuildStep = { label: string; detail: string; state: 'wait' | 'run' | 'done' | 'skip' | 'fail'; from?: number; to?: number; note?: string }
const BUILD_STEPS: Omit<BuildStep, 'state'>[] = [
  { label: 'Read the figures fresh', detail: 'Followers, views, reach and every post, from the client’s accounts' },
  { label: 'Explain the posts', detail: 'Each ticked post compared with the last 90 days — about a minute' },
  { label: 'Write the report', detail: 'The AI writes it from all of the above — a minute or two' },
]

function BuildProgress({ steps }: { steps: BuildStep[] }) {
  // a clock, so a long step is seen to be moving
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const secs = (s: BuildStep) => (s.from ? Math.max(0, Math.round(((s.to ?? now) - s.from) / 1000)) : null)
  const clock = (n: number | null) => (n == null ? '' : n < 60 ? `${n}s` : `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, '0')}s`)
  const at = (ms?: number) => (ms ? new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : '')
  const done = steps.filter(s => s.state === 'done' || s.state === 'skip').length
  const failed = steps.some(s => s.state === 'fail')
  const finished = done === steps.length
  return (
    <div className="flex flex-col gap-3 rounded-inner border border-border bg-background p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <p className="text-[15px] font-semibold">{failed ? 'The build stopped' : finished ? 'Report built' : 'Building the report…'}</p>
        <span className="ml-auto text-[13px] tabular-nums text-muted-foreground">{done} of {steps.length} done</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all duration-700 ${failed ? 'bg-accent-red' : 'bg-foreground'}`}
          style={{ width: `${Math.max(4, ((done + (steps.some(s => s.state === 'run') ? 0.5 : 0)) / steps.length) * 100)}%` }} />
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s.label} className={`flex items-start gap-3 rounded-inner px-2 py-2 ${s.state === 'run' ? 'bg-muted/60' : ''}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
              s.state === 'done' ? 'bg-accent-green text-white'
                : s.state === 'fail' ? 'bg-accent-red text-white'
                : s.state === 'skip' ? 'bg-tint-amber text-foreground'
                : s.state === 'run' ? 'border-2 border-foreground border-t-transparent animate-spin'
                : 'border border-border text-muted-foreground'}`} aria-hidden>
              {s.state === 'done' ? <Check className="h-3.5 w-3.5" /> : s.state === 'fail' ? '!' : s.state === 'skip' ? '–' : s.state === 'run' ? '' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[14px] ${s.state === 'wait' ? 'text-muted-foreground' : 'font-semibold'}`}>{s.label}</p>
              <p className="text-[12px] text-muted-foreground">{s.note ?? s.detail}</p>
            </div>
            <span className="shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
              {s.state === 'run' ? clock(secs(s)) : s.state === 'wait' ? 'waiting' : `${at(s.to)} · ${clock(secs(s))}`}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
