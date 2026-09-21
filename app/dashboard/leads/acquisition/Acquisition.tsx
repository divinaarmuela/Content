'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTable } from '@/lib/db-client'
import type { Prospect as ProspectRow, ProspectEvent, TeamUser } from '@/lib/db-types'
import PageTitle from '../../ui/PageTitle'
import Chip from '../../ui/Chip'
import WorkCard from '../../ui/WorkCard'
import { LaneBoard, type Lane } from '../../production/LaneBoard'
import { useRole } from '../../useRole'
import { LoadFailed } from '../../NotSetUp'
import { personLabel } from '../../../lib/identity-core'
import {
  ACQ_SOURCES, ACQ_STAGES, ACQ_TIERS, PIPELINE_STAGES, TARGET_STAGES, acqBySource, acqByTier, acqDaysOver, acqFunnel,
  acqLimitWords, acqStageByKey, isLeadStage, medianDays, scoreBand, scoreOf,
  type AcqEvent, type AcqEventKind, type AcqStageKey, type Prospect,
} from '../../../lib/acquisition-core'
import ProspectSheet from './ProspectSheet'

/**
 * THE ACQUISITION SYSTEM'S FOUR VIEWS (the blueprint, §10), one component so
 * they share the live data, the filters and the prospect panel:
 *   targets   — research, content, outreach: before a business is a lead
 *   pipeline  — engaged to handoff: the sales road
 *   contacts  — everyone, one row each
 *   reporting — the funnel, by tier, by source, and the speed between stages
 * It sits under Leads as sub-links and leaves the live Leads page alone.
 */

export type AcqView = 'targets' | 'pipeline' | 'contacts' | 'reporting'

const VIEWS: { key: AcqView; label: string; href: string }[] = [
  { key: 'targets', label: 'Targets', href: '/dashboard/leads/acquisition/targets' },
  { key: 'pipeline', label: 'Pipeline', href: '/dashboard/leads/acquisition' },
  { key: 'contacts', label: 'Contacts', href: '/dashboard/leads/acquisition/contacts' },
  { key: 'reporting', label: 'Reporting', href: '/dashboard/leads/acquisition/reporting' },
]

const SUMMARY: Record<AcqView, string> = {
  targets: 'Businesses worth an audit, before any contact. Research it, make the audit, send it. A target becomes a lead only when it replies, clicks or books.',
  pipeline: 'Every business that showed a real signal, from first reply to handoff. It moves right when the stage’s data is captured; the score says where to spend energy.',
  contacts: 'Everyone in the acquisition system, targets and leads alike, one row each: where they came from, where they sit, who owns them.',
  reporting: 'What the engine did and which segments answer. Every number is a count of prospects and confirmed events, so it can be traced back.',
}

const ALL = 'all'
type Row = ProspectRow & Prospect

export default function Acquisition({ view }: { view: AcqView }) {
  const { me } = useRole()
  const { rows: prospects, loading, error } = useTable<Row>('prospects')
  const { rows: eventRows } = useTable<ProspectEvent>('prospect_events')
  const { rows: team } = useTable<TeamUser>('team_users')
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : null }
  const now = Date.now()

  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState(ALL)
  const [source, setSource] = useState(ALL)
  const [owner, setOwner] = useState(ALL)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Row | null>(null)

  // a link from an email opens the prospect it is about
  useEffect(() => {
    try { const id = new URLSearchParams(window.location.search).get('prospect'); if (id) setOpen(id) } catch { /* no address */ }
  }, [])

  const eventsBy = useMemo(() => {
    const m = new Map<string, AcqEvent[]>()
    for (const e of eventRows as unknown as AcqEvent[]) { const l = m.get(e.prospect_id) ?? []; l.push(e); m.set(e.prospect_id, l) }
    return m
  }, [eventRows])
  const scoreFor = (id: string) => scoreOf(eventsBy.get(id) ?? [])

  const shown = useMemo(() => prospects.filter(p => {
    if (tier !== ALL && String(p.tier ?? '') !== tier) return false
    if (source !== ALL && p.source !== source) return false
    if (owner !== ALL && p.owner_id !== owner) return false
    const q = search.trim().toLowerCase()
    return !q || [p.business, p.contact_name, p.email, p.instagram, p.industry].some(v => String(v ?? '').toLowerCase().includes(q))
  }), [prospects, tier, source, owner, search])

  const call = async (url: string, method: string, body: unknown, said?: string) => {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      const json = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      if (said) toast.success(said)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return false } finally { setBusy(false) }
  }

  /** the agent looks the business up (about a minute), and says what it filled in */
  const researchNow = async (id: string) => {
    setBusy(true)
    const wait = toast.loading('Looking the business up — about a minute…')
    try {
      const res = await fetch(`/api/leads/acquisition/${id}/research`, { method: 'POST' })
      const json = await res.json().catch(() => ({})) as { error?: string; run?: { found: boolean; filled: string[]; proposed: string[] } }
      if (!res.ok || !json.run) throw new Error(json.error ?? 'The research did not finish')
      const r = json.run
      toast.success(!r.found ? 'It could not be sure which business this is — the note on the timeline says what it saw'
        : `Research is on the timeline${r.filled.length ? ` · filled in ${r.filled.length} ${r.filled.length === 1 ? 'field' : 'fields'}` : ''}${r.proposed.length ? ` · ${r.proposed.length} to confirm` : ''}`, { id: wait })
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The research did not finish', { id: wait }); return false } finally { setBusy(false) }
  }

  /** the agent's pass for one prospect, and what it found in words */
  const checkNow = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/acquisition/${id}/agent`, { method: 'POST' })
      const json = await res.json().catch(() => ({})) as { error?: string; run?: { gathered: number; fresh: number; recorded: number; asked: number } }
      if (!res.ok || !json.run) throw new Error(json.error ?? 'The agent could not look')
      const r = json.run
      toast.success(r.gathered === 0 ? 'Nothing in the inboxes with this business yet'
        : r.fresh === 0 ? `Read ${r.gathered} ${r.gathered === 1 ? 'message' : 'messages'} — nothing new since last time`
        : `Read ${r.fresh} new ${r.fresh === 1 ? 'message' : 'messages'}: ${r.recorded} added to the timeline, ${r.asked} to confirm`)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'The agent could not look'); return false } finally { setBusy(false) }
  }

  const lanesFor = (keys: readonly AcqStageKey[]): Lane[] => keys.map(k => {
    const s = acqStageByKey(k)
    const cards = shown.filter(p => acqStageByKey(p.stage).key === k && !p.not_now_at && !p.dormant_at)
      .sort((a, b) => scoreFor(b.id) - scoreFor(a.id))
    return {
      key: k, title: `${s.n}. ${s.label}`, count: cards.length, empty: `Nothing at ${s.label.toLowerCase()}.`,
      hint: <span className="sr-only">Seat: {s.owner}.</span>,
      cards: cards.map(p => {
        const over = (acqDaysOver(p, now) ?? 0) > 0
        const score = scoreFor(p.id)
        const band = scoreBand(score)
        const who = nameOf(p.owner_id)
        return (
          <WorkCard key={p.id} client={[p.tier ? `Tier ${p.tier}` : 'No tier', ACQ_SOURCES.find(x => x.key === p.source)?.label].filter(Boolean).join(' · ')}
            title={p.business} tone={over ? 'red' : undefined} onOpen={() => setOpen(p.id)}
            people={p.owner_id ? [{ initials: (who ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), name: who ?? undefined }] : []}
            chips={<>
              <Chip tone={band.tone}>Score {score}</Chip>
              {acqLimitWords(p, now) && <Chip tone={over ? 'red' : 'muted'}>{acqLimitWords(p, now)}</Chip>}
            </>}
            note={<>{p.next_action ? <span className="block">Next: {p.next_action}</span> : <span className="block text-muted-foreground">{s.meaning}</span>}{!p.owner_id && <span className="block text-muted-foreground">Nobody owns this yet</span>}</>}
          />
        )
      }),
    }
  })

  const parked = shown.filter(p => (p.not_now_at || p.dormant_at) && (view === 'targets' ? !isLeadStage(p.stage) : isLeadStage(p.stage)))
  const late = shown.filter(p => (acqDaysOver(p, now) ?? 0) > 0 && (view === 'targets' ? !isLeadStage(p.stage) : isLeadStage(p.stage)))
  const current = open ? prospects.find(p => p.id === open) ?? null : null
  const people = team.filter(u => u.active_status !== false && u.role !== 'client')

  return (
    <div className="flex flex-col gap-4" data-acquisition={view}>
      <PageTitle title={VIEWS.find(v => v.key === view)!.label} summary={SUMMARY[view]}
        actions={<Button onClick={() => setAdding(true)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90"><Plus className="mr-1.5 h-4 w-4" aria-hidden /> Add a target</Button>} />

      <nav aria-label="Acquisition views" className="flex flex-wrap items-center gap-2">
        {VIEWS.map(v => (
          <Link key={v.key} href={v.href} aria-current={v.key === view ? 'page' : undefined}
            className={`inline-flex h-11 items-center rounded-full px-4 text-[13px] font-semibold ${v.key === view ? 'bg-foreground text-background' : 'border border-border bg-surface text-muted-foreground hover:text-foreground'}`}>{v.label}</Link>
        ))}
        <Link href="/dashboard/leads" className="ml-auto inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground">The Leads inbox</Link>
      </nav>

      {view !== 'reporting' && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Narrow the list">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search business, contact, handle…" className="h-11 w-64 rounded-full bg-surface px-4" aria-label="Search prospects" />
          <Select value={tier} onValueChange={setTier}><SelectTrigger className="h-11 w-40 rounded-full bg-surface px-4 text-[13px] font-semibold" aria-label="Tier"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>All tiers</SelectItem>{ACQ_TIERS.map(t => <SelectItem key={t.n} value={String(t.n)}>Tier {t.n}</SelectItem>)}</SelectContent></Select>
          <Select value={source} onValueChange={setSource}><SelectTrigger className="h-11 w-48 rounded-full bg-surface px-4 text-[13px] font-semibold" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Any source</SelectItem>{ACQ_SOURCES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent></Select>
          <Select value={owner} onValueChange={setOwner}><SelectTrigger className="h-11 w-48 rounded-full bg-surface px-4 text-[13px] font-semibold" aria-label="Owner"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={ALL}>Everyone</SelectItem>{people.map(u => <SelectItem key={u.id} value={u.id}>{u.id === me?.id ? 'Me' : personLabel(u.name, u.email)}</SelectItem>)}</SelectContent></Select>
        </div>
      )}

      {error ? <LoadFailed what="the acquisition system" detail={error} onRetry={() => window.location.reload()} />
        : loading ? <Skeleton className="h-64 w-full rounded-card" />
        : view === 'targets' || view === 'pipeline' ? (
          <>
            {late.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px]" role="status">
                <span className="font-semibold">{late.length} past {late.length === 1 ? 'its' : 'their'} time:</span>
                {late.slice(0, 6).map(p => <button key={p.id} type="button" onClick={() => setOpen(p.id)} className="min-h-9 underline underline-offset-4">{p.business}</button>)}
              </div>
            )}
            <LaneBoard lanes={lanesFor(view === 'targets' ? TARGET_STAGES : PIPELINE_STAGES)} ariaLabel={view === 'targets' ? 'Targets, three stages' : 'The pipeline, eight stages'} />
            {parked.length > 0 && (
              <div className="flex flex-col gap-1 rounded-inner border border-border bg-card p-3">
                <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">{view === 'targets' ? 'Dormant — recycle with a new audit or a result' : 'Not now — re-opened after 90 days'}</p>
                <ul className="flex flex-wrap gap-2">{parked.map(p => <li key={p.id}><button type="button" onClick={() => setOpen(p.id)} className="inline-flex min-h-9 items-center rounded-full border border-border px-3 text-[13px]">{p.business}</button></li>)}</ul>
              </div>
            )}
          </>
        ) : view === 'contacts' ? (
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="w-full min-w-[860px] text-left text-[13px]">
              <thead className="bg-foreground/[0.04] font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>{['Business · contact', 'Email · handle', 'Stage', 'Source', 'Owner', 'Score'].map(h => <th key={h} scope="col" className="px-4 py-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Nobody here yet. Add a target to start.</td></tr>}
                {[...shown].sort((a, b) => scoreFor(b.id) - scoreFor(a.id)).map(p => {
                  const score = scoreFor(p.id)
                  return (
                    <tr key={p.id} onClick={() => setOpen(p.id)} className="cursor-pointer border-t border-border hover:bg-foreground/[0.03]">
                      <td className="px-4 py-3"><span className="font-semibold">{p.business}</span><span className="block text-muted-foreground">{[p.contact_name, p.tier ? `Tier ${p.tier}` : null].filter(Boolean).join(' · ') || '—'}</span></td>
                      <td className="px-4 py-3 text-muted-foreground">{p.email || '—'}<span className="block">{p.instagram ? `@${p.instagram}` : ''}</span></td>
                      <td className="px-4 py-3"><Chip tone={p.dormant_at || p.not_now_at ? 'muted' : isLeadStage(p.stage) ? 'surface' : 'muted'}>{p.dormant_at ? 'Dormant' : p.not_now_at ? 'Not now' : acqStageByKey(p.stage).label}</Chip></td>
                      <td className="px-4 py-3">{ACQ_SOURCES.find(s => s.key === p.source)?.label ?? '—'}</td>
                      <td className="px-4 py-3">{nameOf(p.owner_id) ?? '—'}</td>
                      <td className="px-4 py-3 font-semibold">{score}<span className="block text-[12px] font-normal text-muted-foreground">{scoreBand(score).label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <Reporting prospects={prospects} />}

      <Sheet open={current !== null} onOpenChange={o => { if (!o) setOpen(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-popover sm:max-w-2xl">
          {current && (
            <ProspectSheet prospect={current} events={eventsBy.get(current.id) ?? []} team={team} viewer={me ? { id: me.id, role: me.role } : null} busy={busy} now={now}
              patch={body => call(`/api/leads/acquisition/${current.id}`, 'PATCH', body)}
              move={(action, said) => call(`/api/leads/acquisition/${current.id}/stage`, 'POST', { action }, said)}
              log={(kind: AcqEventKind, detail, said) => call(`/api/leads/acquisition/${current.id}/events`, 'POST', { kind, detail }, said)}
              remove={() => setDeleting(current)}
              answer={(eventId, confirm) => call(`/api/leads/acquisition/${current.id}/events/${eventId}`, 'POST', { confirm }, confirm ? 'Confirmed — it counts now' : 'Dismissed')}
              check={() => checkNow(current.id)}
              research={() => researchNow(current.id)} />
          )}
        </SheetContent>
      </Sheet>

      <NewTarget open={adding} busy={busy} onClose={() => setAdding(false)}
        onCreate={async body => { if (await call('/api/leads/acquisition', 'POST', body, 'Target added')) { setAdding(false); return true } return false }} />

      <AlertDialog open={!!deleting} onOpenChange={o => { if (!o && !busy) setDeleting(null) }}>
        <AlertDialogContent className="bg-popover">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this prospect?</AlertDialogTitle>
            <AlertDialogDescription>“{deleting?.business}” and its whole timeline go for everyone. It cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
            <AlertDialogAction disabled={busy} className="bg-accent-red hover:bg-accent-red/90"
              onClick={async e => { e.preventDefault(); if (deleting && await call(`/api/leads/acquisition/${deleting.id}`, 'DELETE', undefined, 'Prospect deleted')) { setDeleting(null); setOpen(null) } }}>Delete the prospect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function NewTarget({ open, busy, onClose, onCreate }: { open: boolean; busy: boolean; onClose: () => void; onCreate: (body: Record<string, unknown>) => Promise<boolean> }) {
  const [business, setBusiness] = useState('')
  const [tier, setTier] = useState('none')
  const [source, setSource] = useState('outbound')
  const [website, setWebsite] = useState('')
  const [instagram, setInstagram] = useState('')
  const [angle, setAngle] = useState('')
  const [fit, setFit] = useState(false)
  const [weak, setWeak] = useState(false)
  const reset = () => { setBusiness(''); setTier('none'); setSource('outbound'); setWebsite(''); setInstagram(''); setAngle(''); setFit(false); setWeak(false) }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !busy) onClose() }}>
      <DialogContent className="bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a target</DialogTitle>
          <DialogDescription>A business worth an audit. It starts at Research target; nobody is contacted by adding it.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={async e => {
          e.preventDefault()
          if (!business.trim()) { toast.error('Give the business’s name'); return }
          if (await onCreate({ business, tier: tier === 'none' ? null : Number(tier), source, website: website || null, instagram: instagram || null, audit_angle: angle || null, fit_strong: fit, weak_presence: weak })) reset()
        }}>
          <div className="flex flex-col gap-2"><Label htmlFor="t-business">Business</Label><Input id="t-business" autoFocus value={business} onChange={e => setBusiness(e.target.value)} className="h-11" placeholder="Harbourline Buyers Advocates" /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2"><Label>Tier</Label>
              <Select value={tier} onValueChange={setTier}><SelectTrigger className="h-11" aria-label="Tier"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Not placed yet</SelectItem>{ACQ_TIERS.map(t => <SelectItem key={t.n} value={String(t.n)}>Tier {t.n} — {t.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex flex-col gap-2"><Label>Source</Label>
              <Select value={source} onValueChange={setSource}><SelectTrigger className="h-11" aria-label="Source"><SelectValue /></SelectTrigger>
                <SelectContent>{ACQ_SOURCES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="flex flex-col gap-2"><Label htmlFor="t-web">Website</Label><Input id="t-web" value={website} onChange={e => setWebsite(e.target.value)} className="h-11" placeholder="business.com.au" /></div>
            <div className="flex flex-col gap-2"><Label htmlFor="t-ig">Instagram handle</Label><Input id="t-ig" value={instagram} onChange={e => setInstagram(e.target.value)} className="h-11" placeholder="@handle" /></div>
          </div>
          <div className="flex flex-col gap-2"><Label htmlFor="t-angle">Audit angle (optional)</Label><Input id="t-angle" value={angle} onChange={e => setAngle(e.target.value)} className="h-11" placeholder="What they are missing, in a line" /></div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" className="h-5 w-5 accent-foreground" checked={fit} onChange={e => setFit(e.target.checked)} /> A strong fit for the tier <span className="text-muted-foreground">+10</span></label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]"><input type="checkbox" className="h-5 w-5 accent-foreground" checked={weak} onChange={e => setWeak(e.target.checked)} /> Weak website or social presence <span className="text-muted-foreground">+5</span></label>
          <Button type="submit" disabled={busy} className="h-11 rounded-full bg-foreground text-[13px] font-semibold text-background hover:bg-foreground/90">{busy ? 'Adding…' : 'Add the target'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Reporting({ prospects }: { prospects: Row[] }) {
  const funnel = acqFunnel(prospects)
  const top = Math.max(1, funnel[0]?.reached ?? 1)
  const byTier = acqByTier(prospects)
  const bySource = acqBySource(prospects)
  const speed: [string, keyof Prospect, keyof Prospect][] = [
    ['Target added → outreach', 'created_at', 'outreach_at'], ['Outreach → reply', 'outreach_at', 'replied_at'], ['Reply → call', 'replied_at', 'call_at'],
    ['Call → proposal', 'call_at', 'proposal_sent_at'], ['Proposal → deposit paid', 'proposal_sent_at', 'deposit_paid_at'],
  ]
  const card = 'flex flex-col gap-3 rounded-card border border-border bg-card p-4'
  const h = 'text-[15px] font-semibold'
  if (prospects.length === 0) return <div className="rounded-card border border-dashed border-border p-10 text-center text-[14px] text-muted-foreground">No numbers yet. They appear as targets are added and move.</div>
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className={`${card} lg:col-span-1`} aria-label="The funnel">
        <h2 className={h}>Funnel — how many reached each stage</h2>
        {funnel.map(f => (
          <div key={f.key} className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)_32px] items-center gap-2 text-[13px]">
            <span className="truncate">{f.label}</span>
            <span className="flex"><span className={`h-5 rounded ${isLeadStage(f.key) ? 'bg-accent-amber' : 'bg-foreground'}`} style={{ width: `${Math.max(2, (f.reached / top) * 100)}%` }} /></span>
            <span className="text-right font-semibold">{f.reached}</span>
          </div>
        ))}
      </section>
      <section className={card} aria-label="By tier and by source">
        <h2 className={h}>By tier — sent, replies, calls, signed</h2>
        {ACQ_TIERS.map(t => { const r = byTier.get(t.n); return <p key={t.n} className="flex justify-between gap-3 text-[13px]"><span>Tier {t.n} · {t.label}</span><span className="shrink-0 font-semibold">{r ? `${r.sent} · ${r.replies} · ${r.calls} · ${r.signed}` : '—'}</span></p> })}
        <h2 className={`${h} mt-2`}>By source — signed of sent</h2>
        {ACQ_SOURCES.map(s => { const r = bySource.get(s.key); return <p key={s.key} className="flex justify-between gap-3 text-[13px]"><span>{s.label}</span><span className="shrink-0 font-semibold">{r ? `${r.signed} of ${r.sent}` : '—'}</span></p> })}
      </section>
      <section className={card} aria-label="Speed">
        <h2 className={h}>Speed — median days</h2>
        {speed.map(([label, from, to]) => { const d = medianDays(prospects, from, to); return <p key={label} className="flex justify-between gap-3 text-[13px]"><span>{label}</span><span className="shrink-0 font-semibold">{d === null ? '—' : d}</span></p> })}
        <h2 className={`${h} mt-2`}>Right now</h2>
        <p className="flex justify-between text-[13px]"><span>Targets, not yet leads</span><span className="font-semibold">{prospects.filter(p => !isLeadStage(p.stage)).length}</span></p>
        <p className="flex justify-between text-[13px]"><span>Leads in the pipeline</span><span className="font-semibold">{prospects.filter(p => isLeadStage(p.stage)).length}</span></p>
        <p className="flex justify-between text-[13px]"><span>Dormant or not now</span><span className="font-semibold">{prospects.filter(p => p.dormant_at || p.not_now_at).length}</span></p>
        <p className="text-[12px] text-muted-foreground">{ACQ_STAGES.length} stages in all; a business counts as a lead from stage 4.</p>
      </section>
    </div>
  )
}
