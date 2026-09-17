'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, PauseCircle, PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useTable } from '@/lib/db-client'
import type { Lead, TeamUser } from '@/lib/db-types'
import Chip from '../ui/Chip'
import WorkCard from '../ui/WorkCard'
import { LaneBoard, type Lane } from '../production/LaneBoard'
import { personLabel } from '../../lib/identity-core'
import {
  OBJECTIONS, QUALIFIERS, SOURCE_TAGS, STAGES, TIERS, WEEKLY_TARGETS, daysOver, exitState, exitTicksOf, limitWords, moveRefusal, nextStage,
  qualifiersOf, scoreboard, stageOf, touchPlan, touchesDone, weekBounds, type PipelineLead, type StageKey,
} from '../../lib/pipeline-core'

/**
 * THE PIPELINE ON THE LEADS PAGE (the acquisition doc, 17 Sep 2026): the
 * seven stages as columns, one card per deal, the stage's time limit on the
 * card, red once it is over. A press opens the deal: the exit rule as a
 * checklist, the three qualifiers, who owns it, the dated milestones, the
 * objection, the six follow-up touches with the script and a Sent tick, and
 * Move on — which the server refuses until every line of the exit rule is
 * met. The Monday numbers sit above the board, this week, live.
 */
type Row = Lead & PipelineLead

const field = 'min-h-11 w-full rounded-inner border border-border bg-surface px-3 text-[14px]'
const H = 'text-[12px] font-semibold uppercase tracking-wide text-muted-foreground'

function leadName(l: Row): string {
  return `${l.fname ?? ''} ${l.lname ?? ''}`.trim() || l.email || 'A lead'
}

export default function Pipeline({ leads, viewerId }: { leads: Row[]; viewerId: string | null }) {
  const { rows: team } = useTable<TeamUser>('team_users')
  const nameOf = (uid: string | null | undefined) => { const u = team.find(t => t.id === uid); return u ? personLabel(u.name, u.email) : null }
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const now = Date.now()
  const { start, end } = weekBounds(now)
  const numbers = useMemo(() => scoreboard(leads, start, end), [leads, start, end])
  const live = leads.filter(l => !l.not_now_at)
  const parked = leads.filter(l => !!l.not_now_at)
  const late = live.filter(l => (daysOver(l, now) ?? 0) > 0)

  const patch = async (id: string, body: Record<string, unknown>, said?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not save')
      if (said) toast.success(said)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); return false } finally { setBusy(false) }
  }
  const move = async (id: string, action: 'move' | 'back' | 'not_now' | 'reopen', said: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/leads/${id}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not move it')
      toast.success(said)
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not move it'); return false } finally { setBusy(false) }
  }

  const lanes: Lane[] = STAGES.map(s => {
    const cards = live.filter(l => stageOf(l).key === s.key).sort((a, b) => (daysOver(b, now) ?? 0) - (daysOver(a, now) ?? 0))
    return {
      key: s.key, title: `${s.n}. ${s.label}`, count: cards.length, empty: `Nothing at ${s.label.toLowerCase()}.`,
      hint: <span className="sr-only">Owner {s.owner}. Limit {s.limitDays} {s.limitDays === 1 ? 'day' : 'days'}.</span>,
      cards: cards.map(l => {
        const over = (daysOver(l, now) ?? 0) > 0
        const words = limitWords(l, now)
        const owner = nameOf(l.owner_id)
        return (
          <WorkCard key={l.id} client={l.biz || 'No business named'} title={leadName(l)} tone={over ? 'red' : undefined}
            onOpen={() => setOpen(l.id)}
            people={l.owner_id ? [{ initials: (owner ?? '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), name: owner ?? undefined }] : []}
            chips={<>
              {l.tier && <Chip tone="muted">Tier {l.tier}</Chip>}
              {l.source_tag && <Chip tone="surface">{SOURCE_TAGS.find(t => t.key === l.source_tag)?.label ?? l.source_tag}</Chip>}
              {words && <Chip tone={over ? 'red' : 'muted'}>{words}</Chip>}
            </>}
            note={<>{l.next_action ? <span className="block">Next: {l.next_action}</span> : <span className="block text-muted-foreground">No next action yet</span>}{!l.owner_id && <span className="block text-muted-foreground">Nobody owns it yet</span>}</>}
          />
        )
      }),
    }
  })

  const lead = open ? leads.find(l => l.id === open) ?? null : null

  return (
    <div className="flex flex-col gap-4" data-pipeline>
      {/* ── the Monday numbers, this week ── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="This week’s numbers">
        {[
          { label: 'Leads in', value: numbers.leadsIn, target: `${WEEKLY_TARGETS.leadsIn} a week`, sub: Object.entries(numbers.leadsBySource).map(([k, v]) => `${SOURCE_TAGS.find(t => t.key === k)?.label ?? k} ${v}`).join(' · ') },
          { label: 'Discovery calls held', value: numbers.callsHeld, target: `${WEEKLY_TARGETS.callsHeld} a week` },
          { label: 'Proposals sent', value: numbers.proposalsSent, target: `${WEEKLY_TARGETS.proposalsSent} a week` },
          { label: 'Signed', value: numbers.signed, target: `${WEEKLY_TARGETS.signedPerMonth} a month` },
          { label: 'Deposits collected', value: numbers.deposits, target: 'matches signed' },
          { label: 'Average value signed', value: numbers.averageValue === null ? '—' : `$${numbers.averageValue.toLocaleString('en-AU')}`, target: 'set after 30 days' },
        ].map(n => (
          <div key={n.label} className="rounded-inner border border-border bg-card p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{n.label}</p>
            <p className="text-[22px] font-semibold leading-tight">{n.value}</p>
            <p className="text-[11px] text-muted-foreground">Target {n.target}{n.sub ? ` · ${n.sub}` : ''}</p>
          </div>
        ))}
      </div>
      {late.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-inner border border-accent-red/40 bg-tint-red px-3 py-2 text-[13px]" role="status">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-semibold">{late.length} past {late.length === 1 ? 'its' : 'their'} limit:</span>
          {late.slice(0, 6).map(l => <button key={l.id} type="button" onClick={() => setOpen(l.id)} className="underline underline-offset-4">{leadName(l)}{l.owner_id ? ` (${nameOf(l.owner_id) ?? 'someone'})` : ' (nobody)'}</button>)}
          {late.length > 6 && <span>and {late.length - 6} more</span>}
        </div>
      )}

      <LaneBoard lanes={lanes} ariaLabel="The pipeline, seven stages" />

      {parked.length > 0 && (
        <div className="flex flex-col gap-1 rounded-inner border border-border bg-card p-3">
          <p className={H}>Not now — re-opened after 90 days with a new teardown or a result</p>
          <ul className="flex flex-wrap gap-2">
            {parked.map(l => <li key={l.id}><button type="button" onClick={() => setOpen(l.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] hover:bg-muted"><PauseCircle className="h-3.5 w-3.5" aria-hidden />{leadName(l)}{l.reopen_at ? ` · back ${new Date(l.reopen_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}</button></li>)}
          </ul>
        </div>
      )}

      <Sheet open={lead !== null} onOpenChange={o => { if (!o) setOpen(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {lead && <DealSheet lead={lead} team={team} nameOf={nameOf} viewerId={viewerId} busy={busy} patch={patch} move={move} now={now} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function DealSheet({ lead, team, nameOf, viewerId, busy, patch, move, now }: {
  lead: Row; team: TeamUser[]; nameOf: (uid: string | null | undefined) => string | null; viewerId: string | null; busy: boolean
  patch: (id: string, body: Record<string, unknown>, said?: string) => Promise<boolean>
  move: (id: string, action: 'move' | 'back' | 'not_now' | 'reopen', said: string) => Promise<boolean>
  now: number
}) {
  const stage = stageOf(lead)
  const next = nextStage(stage.key)
  const exits = exitState(lead)
  const refusal = moveRefusal(lead)
  const q = qualifiersOf(lead)
  const ticks = exitTicksOf(lead, stage.key)
  const plan = touchPlan(lead, now)
  const [note, setNote] = useState(lead.pipeline_notes ?? '')
  const [nextAction, setNextAction] = useState(lead.next_action ?? '')
  const [value, setValue] = useState(lead.deal_value ? String(lead.deal_value) : '')
  const [partner, setPartner] = useState(lead.partner ?? '')
  const dateInput = (iso: string | null | undefined) => iso ? new Date(iso).toISOString().slice(0, 16) : ''
  const setDate = (key: string, v: string) => patch(lead.id, { [key]: v ? new Date(v).toISOString() : null })
  const tick = (line: string, on: boolean) => patch(lead.id, { exit_ticks: { ...(lead.exit_ticks && typeof lead.exit_ticks === 'object' ? lead.exit_ticks as object : {}), [stage.key]: { ...ticks, [line]: on } } })
  const people = team.filter(u => u.active_status !== false && u.role !== 'client')

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div>
        <p className={H}>{lead.biz || 'No business named'}{lead.tier ? ` · Tier ${lead.tier}` : ''}</p>
        <SheetTitle className="text-section-title">{leadName(lead)}</SheetTitle>
        <p className="text-[13px] text-muted-foreground">{[lead.email, lead.phone].filter(Boolean).join(' · ')}{lead.need ? ` · ${lead.need}` : ''}{lead.budget ? ` · budget ${lead.budget}` : ''}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone={lead.not_now_at ? 'muted' : (daysOver(lead, now) ?? 0) > 0 ? 'red' : 'surface'}>{stage.n}. {stage.label}</Chip>
          {limitWords(lead, now) && <Chip tone={(daysOver(lead, now) ?? 0) > 0 ? 'red' : 'muted'}>{limitWords(lead, now)}</Chip>}
          <span className="text-[12px] text-muted-foreground">Owner’s seat: {stage.owner}</span>
        </div>
      </div>

      {/* ── the move ── */}
      <section className="flex flex-col gap-2 rounded-inner border border-border p-3" aria-labelledby="deal-exit">
        <p id="deal-exit" className={H}>To leave this stage</p>
        <ul className="flex flex-col gap-1">
          {exits.map(x => (
            <li key={x.line} className="flex min-h-9 items-center gap-2 text-[14px]">
              {x.auto
                ? <span className={`flex h-5 w-5 items-center justify-center rounded-full ${x.met ? 'bg-accent-green text-ink' : 'border border-border'}`} aria-hidden>{x.met && <Check className="h-3 w-3" strokeWidth={3} />}</span>
                : <input type="checkbox" className="h-5 w-5 accent-foreground" checked={x.met} disabled={busy} onChange={e => void tick(x.line, e.target.checked)} aria-label={x.line} />}
              <span className={x.met ? '' : 'text-foreground'}>{x.line}</span>
              {x.auto && !x.met && <span className="text-[12px] text-muted-foreground">— from the fields below</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {lead.not_now_at ? (
            <Button disabled={busy} onClick={() => void move(lead.id, 'reopen', 'Back in the pipeline')} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background"><PlayCircle className="mr-1.5 h-4 w-4" aria-hidden /> Re-open</Button>
          ) : (
            <>
              {next && (
                <Button disabled={busy || !!refusal} title={refusal ?? undefined} onClick={() => void move(lead.id, 'move', `Moved to ${next.label}`)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background disabled:opacity-60">
                  Move to {next.n}. {next.label} <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
              )}
              {stage.n > 1 && <Button variant="outline" disabled={busy} onClick={() => void move(lead.id, 'back', 'Moved back a stage')} className="h-11 rounded-full px-4 text-[13px] font-semibold"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back</Button>}
              <Button variant="outline" disabled={busy} onClick={() => void move(lead.id, 'not_now', 'Parked — re-opens in 90 days')} className="h-11 rounded-full px-4 text-[13px] font-semibold"><PauseCircle className="mr-1.5 h-4 w-4" aria-hidden /> Not now</Button>
            </>
          )}
        </div>
        {refusal && !lead.not_now_at && <p className="text-[12px] text-muted-foreground">{refusal}</p>}
      </section>

      {/* ── who, what, where from ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="The deal">
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Owner
          <Select value={lead.owner_id ?? 'none'} onValueChange={v => void patch(lead.id, { owner_id: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Owner"><SelectValue placeholder="Nobody yet" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody yet</SelectItem>
              {people.map(u => <SelectItem key={u.id} value={u.id}>{u.id === viewerId ? 'Me' : personLabel(u.name, u.email)}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Tier
          <Select value={lead.tier ? String(lead.tier) : 'none'} onValueChange={v => void patch(lead.id, { tier: v === 'none' ? null : Number(v) })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Tier"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not placed yet</SelectItem>
              {TIERS.map(t => <SelectItem key={t.n} value={String(t.n)}>Tier {t.n} — {t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Source
          <Select value={lead.source_tag ?? 'none'} onValueChange={v => void patch(lead.id, { source_tag: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not tagged</SelectItem>
              {SOURCE_TAGS.map(t => <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        {lead.source_tag === 'partner' && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">Which partner
            <input value={partner} onChange={e => setPartner(e.target.value)} onBlur={() => { if (partner.trim() !== (lead.partner ?? '')) void patch(lead.id, { partner: partner.trim() || null }) }} className={field} placeholder="e.g. See the Label" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[12px] font-semibold sm:col-span-2">Next action
          <input value={nextAction} onChange={e => setNextAction(e.target.value)} onBlur={() => { if (nextAction.trim() !== (lead.next_action ?? '')) void patch(lead.id, { next_action: nextAction.trim() || null }) }} className={field} placeholder="What happens next, and who does it" />
        </label>
      </section>

      {/* ── the three qualifiers ── */}
      <section className="flex flex-col gap-1" aria-labelledby="deal-q">
        <p id="deal-q" className={H}>The 3 qualifiers, before a call is booked</p>
        {QUALIFIERS.map(k => (
          <label key={k.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px]">
            <input type="checkbox" className="h-5 w-5 accent-foreground" checked={q[k.key] === true} disabled={busy} onChange={e => void patch(lead.id, { qualifiers: { ...q, [k.key]: e.target.checked } })} />
            {k.label}
          </label>
        ))}
      </section>

      {/* ── the dated milestones ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="When things happened">
        {([['call_at', 'Discovery call'], ['walkthrough_at', 'Walkthrough'], ['proposal_sent_at', 'Proposal sent'], ['signed_at', 'Agreement signed'], ['deposit_at', 'Deposit received'], ['vs_delivered_at', 'Visibility System delivered']] as const).map(([k, label]) => (
          <label key={k} className="flex flex-col gap-1 text-[12px] font-semibold">{label}
            <input type="datetime-local" value={dateInput(lead[k])} onChange={e => void setDate(k, e.target.value)} className={field} disabled={busy} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Deal value, AUD ex GST
          <input inputMode="numeric" value={value} onChange={e => setValue(e.target.value)} onBlur={() => { const n = value.trim() === '' ? null : Number(value); if (n !== (lead.deal_value ?? null)) void patch(lead.id, { deal_value: n }) }} className={field} placeholder="e.g. 12000" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Objection, if any
          <Select value={lead.objection ?? 'none'} onValueChange={v => void patch(lead.id, { objection: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Objection"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None logged</SelectItem>
              {OBJECTIONS.map(o => <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
      </section>

      {/* ── the six touches ── */}
      <section className="flex flex-col gap-2" aria-labelledby="deal-touches">
        <p id="deal-touches" className={H}>Follow-up, six touches over three weeks</p>
        <ul className="flex flex-col gap-1.5">
          {plan.map(t => (
            <li key={t.day} className={`rounded-inner border p-2.5 text-[13px] ${t.overdue ? 'border-accent-red/50 bg-tint-red' : 'border-border'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-foreground" checked={!!t.done_at} disabled={busy}
                  onChange={e => void patch(lead.id, { touches: e.target.checked ? [...touchesDone(lead), { day: t.day, done_at: new Date().toISOString(), by: viewerId }] : touchesDone(lead).filter(x => x.day !== t.day) }, e.target.checked ? 'Marked sent' : undefined)}
                  aria-label={`Day ${t.day} ${t.channel} sent`} />
                <span className="font-semibold">Day {t.day} · {t.channel} · {t.sender}</span>
                <span className="text-muted-foreground">{t.trigger}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{t.done_at ? `sent ${new Date(t.done_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : t.due_at ? `${t.overdue ? 'was due' : 'due'} ${new Date(t.due_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : 'not triggered yet'}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-muted-foreground">{t.script}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1" aria-labelledby="deal-notes">
        <p id="deal-notes" className={H}>Notes on the deal</p>
        <textarea rows={4} value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note.trim() !== (lead.pipeline_notes ?? '')) void patch(lead.id, { pipeline_notes: note.trim() || null }) }} className={`${field} resize-none py-2`} placeholder="What they said on the call, their numbers, who else decides" />
      </section>
    </div>
  )
}
