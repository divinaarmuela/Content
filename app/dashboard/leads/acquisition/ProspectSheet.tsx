'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, Link2, PauseCircle, PlayCircle, Sparkles, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { copyText } from '../../../lib/copy-text-client'
import { destinationFor, TRACKED_KINDS, TRACKED_WORDS, trackedLink, trackedPath } from '../../../lib/tracked-link-core'
import { isOpenFinding } from '../../../lib/acq-agent-core'
import { Button } from '@/components/ui/button'
import { SheetTitle } from '@/components/ui/sheet'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { TeamUser } from '@/lib/db-types'
import Chip from '../../ui/Chip'
import { personLabel } from '../../../lib/identity-core'
import {
  ACQ_EVENT_KINDS, ACQ_SOURCES, ACQ_TIERS, OUTREACH_CHANNELS, acqDaysOver, acqLimitWords, acqMoveRefusal, acqStageByKey,
  captureState, followUpPlan, isAcqEventKind, mayDeleteProspect, nextAcqStage, scoreBand, scoreOf, weaknessTagsOf,
  type AcqEvent, type AcqEventKind, type Prospect,
} from '../../../lib/acquisition-core'

/**
 * ONE PROSPECT (the blueprint's "Prospect Profile Page", §10): who they are,
 * where they sit, what the stage still needs, the assets and the money, the
 * follow-up plan, and the timeline the score is summed from. Everything
 * saves on blur; a move is one button that the stage's own rule unlocks.
 */

const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'
const field = 'min-h-11 w-full rounded-inner border border-border bg-surface px-3 text-[14px] font-normal'
const dt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16) : '')
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'Australia/Melbourne' }) : '')
const stamp = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Melbourne' })

export default function ProspectSheet({ prospect: p, events, team, viewer, busy, patch, move, log, remove, now, answer, check, research }: {
  prospect: Prospect
  events: AcqEvent[]
  team: TeamUser[]
  viewer: { id: string; role: string } | null
  busy: boolean
  patch: (body: Record<string, unknown>) => Promise<boolean>
  move: (action: 'move' | 'back' | 'not_now' | 'dormant' | 'reopen', said: string) => Promise<boolean>
  log: (kind: AcqEventKind, detail: string | null, said: string) => Promise<boolean>
  remove: () => void
  /** a person's answer to something the agent found: Confirm, or Not this */
  answer: (eventId: string, confirm: boolean) => Promise<boolean>
  /** the agent's pass for this prospect, now */
  check: () => Promise<boolean>
  /** the agent looks the business up: Instagram's public page, the web, their site */
  research: () => Promise<boolean>
  now: number
}) {
  const stage = acqStageByKey(p.stage)
  const next = nextAcqStage(stage.key)
  const refusal = acqMoveRefusal(p)
  const score = scoreOf(events)
  const band = scoreBand(score)
  const parked = !!p.not_now_at || !!p.dormant_at
  const over = (acqDaysOver(p, now) ?? 0) > 0
  const plan = followUpPlan(p, events, now)
  const people = team.filter(u => u.active_status !== false && u.role !== 'client')
  const [said, setSaid] = useState('')
  const [note, setNote] = useState('')

  const text = (key: keyof Prospect, label: string, placeholder = '', wide = false) => (
    <label className={`flex flex-col gap-1 text-[12px] font-semibold ${wide ? 'sm:col-span-2' : ''}`}>{label}
      <input key={`${String(key)}:${String(p[key] ?? '')}`} defaultValue={String(p[key] ?? '')} placeholder={placeholder} disabled={busy} className={field}
        onBlur={e => { const v = e.target.value.trim(); if (v !== String(p[key] ?? '')) void patch({ [key]: v || null }) }} />
    </label>
  )
  const area = (key: keyof Prospect, label: string, placeholder = '', rows = 3) => (
    <label className="flex flex-col gap-1 text-[12px] font-semibold sm:col-span-2">{label}
      <textarea key={`${String(key)}:${String(p[key] ?? '')}`} defaultValue={String(p[key] ?? '')} rows={rows} placeholder={placeholder} disabled={busy} className={`${field} resize-y p-2.5`}
        onBlur={e => { const v = e.target.value.trim(); if (v !== String(p[key] ?? '')) void patch({ [key]: v || null }) }} />
    </label>
  )
  const when = (key: keyof Prospect, label: string) => (
    <label className="flex flex-col gap-1 text-[12px] font-semibold">{label}
      <input type="datetime-local" key={`${String(key)}:${String(p[key] ?? '')}`} defaultValue={dt(p[key] as string | null)} disabled={busy} className={field}
        onBlur={e => { const v = e.target.value; if (v !== dt(p[key] as string | null)) void patch({ [key]: v ? new Date(v).toISOString() : null }) }} />
    </label>
  )
  const amount = (key: keyof Prospect, label: string) => (
    <label className="flex flex-col gap-1 text-[12px] font-semibold">{label}
      <input inputMode="decimal" key={`${String(key)}:${String(p[key] ?? '')}`} defaultValue={p[key] ? String(p[key]) : ''} placeholder="AUD ex GST" disabled={busy} className={field}
        onBlur={e => { const v = e.target.value.trim(); if (v !== (p[key] ? String(p[key]) : '')) void patch({ [key]: v === '' ? null : v }) }} />
    </label>
  )
  const has = (kind: AcqEventKind) => events.some(e => e.kind === kind)
  const signal = (kind: AcqEventKind, words: string) => (
    <Button key={kind} variant="outline" disabled={busy} onClick={() => void log(kind, null, `${ACQ_EVENT_KINDS[kind].label} logged`)}
      className="h-11 rounded-full px-3 text-[12px] font-semibold">{words}{ACQ_EVENT_KINDS[kind].points ? ` ${ACQ_EVENT_KINDS[kind].points > 0 ? '+' : ''}${ACQ_EVENT_KINDS[kind].points}` : ''}</Button>
  )

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div>
        <p className={H}>{[p.tier ? `Tier ${p.tier}` : null, p.industry, ACQ_SOURCES.find(s => s.key === p.source)?.label].filter(Boolean).join(' · ') || 'No tier yet'}</p>
        <SheetTitle className="text-section-title">{p.business}</SheetTitle>
        <p className="text-[13px] text-muted-foreground">{[p.contact_name, p.email, p.phone, p.instagram ? `@${p.instagram}` : null].filter(Boolean).join(' · ') || 'No contact details yet'}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone={parked ? 'muted' : over ? 'red' : 'surface'}>{stage.n}. {stage.label}</Chip>
          <Chip tone={band.tone}>Score {score} · {band.label}</Chip>
          {acqLimitWords(p, now) && <Chip tone={over ? 'red' : 'muted'}>{acqLimitWords(p, now)}</Chip>}
          <span className="text-[12px] text-muted-foreground">Seat: {stage.owner}</span>
        </div>
        <p className="mt-1 text-[12px] text-muted-foreground">{band.action}.</p>
      </div>

      {/* ── the move ── */}
      <section className="flex flex-col gap-2 rounded-inner border border-border p-3" aria-labelledby="acq-move">
        <p id="acq-move" className={H}>To leave this stage — {stage.meaning.toLowerCase()}</p>
        <ul className="flex flex-col gap-1">
          {captureState(p).map(x => (
            <li key={x.line} className="flex min-h-9 items-center gap-2 text-[14px]">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${x.met ? 'bg-accent-green text-ink' : 'border border-border'}`} aria-hidden>{x.met && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
              <span>{x.line}</span>
              {!x.met && <span className="text-[12px] text-muted-foreground">— from the fields below</span>}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {parked ? (
            <Button disabled={busy} onClick={() => void move('reopen', 'Back on the board')} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90"><PlayCircle className="mr-1.5 h-4 w-4" aria-hidden /> Bring it back</Button>
          ) : (
            <>
              {next && (
                <Button disabled={busy || !!refusal} title={refusal ?? undefined} onClick={() => void move('move', `Moved to ${next.label}`)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
                  {stage.key === 'signed' ? 'Hand off — make the client' : `Move to ${next.n}. ${next.label}`} <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden />
                </Button>
              )}
              {stage.key === 'content' && (
                <Button variant="outline" disabled={busy || has('content_ready') || !(p.loom_url || p.post_url)} onClick={() => void log('content_ready', null, 'Joy is told — her outreach task is made')} className="h-11 rounded-full px-4 text-[13px] font-semibold">{has('content_ready') ? 'Joy was told' : 'Content ready · tell Joy'}</Button>
              )}
              {stage.n > 1 && <Button variant="outline" disabled={busy} onClick={() => void move('back', 'Moved back a stage')} className="h-11 rounded-full px-4 text-[13px] font-semibold"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back a stage</Button>}
              <Button variant="outline" disabled={busy} onClick={() => void move(stage.key === 'outreach' ? 'dormant' : 'not_now', stage.key === 'outreach' ? 'Marked dormant — recycle in 90 days' : 'Parked — re-opens in 90 days')} className="h-11 rounded-full px-4 text-[13px] font-semibold"><PauseCircle className="mr-1.5 h-4 w-4" aria-hidden /> {stage.key === 'outreach' ? 'Dormant' : 'Not now'}</Button>
            </>
          )}
        </div>
        {refusal && !parked && <p className="text-[12px] text-muted-foreground">{refusal}</p>}
        {p.client_id && <Link href={`/dashboard/clients/${p.client_id}`} className="text-[13px] font-semibold underline underline-offset-4">Open the client it became</Link>}
      </section>

      {/* ── who and where from ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="The business">
        {text('business', 'Business')}
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Tier
          <Select value={p.tier ? String(p.tier) : 'none'} onValueChange={v => void patch({ tier: v === 'none' ? null : Number(v) })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Tier"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not placed yet</SelectItem>{ACQ_TIERS.map(t => <SelectItem key={t.n} value={String(t.n)}>Tier {t.n} — {t.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {text('industry', 'Industry', 'Mortgage broking')}
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Source
          <Select value={p.source ?? 'none'} onValueChange={v => void patch({ source: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Source"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not tagged</SelectItem>{ACQ_SOURCES.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {p.source === 'referral' && text('source_detail', 'Referred by', 'Which client or partner')}
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Owner
          <Select value={p.owner_id ?? 'none'} onValueChange={v => void patch({ owner_id: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Owner"><SelectValue placeholder="Nobody yet" /></SelectTrigger>
            <SelectContent><SelectItem value="none">Nobody yet</SelectItem>{people.map(u => <SelectItem key={u.id} value={u.id}>{u.id === viewer?.id ? 'Me' : personLabel(u.name, u.email)}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {text('website', 'Website', 'business.com.au')}
        {text('instagram', 'Instagram handle', '@handle — a DM reply is matched on this')}
        {text('linkedin', 'LinkedIn', 'linkedin.com/company/…')}
        {text('contact_name', 'Contact', 'Who we talk to')}
        {text('contact_role', 'Their role', 'Director')}
        {text('email', 'Email')}
        {text('phone', 'Phone')}
      </section>

      {/* ── the research ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="The research">
        <p className={`${H} sm:col-span-2`}>Research — what is weak, and the angle</p>
        <label className="flex flex-col gap-1 text-[12px] font-semibold sm:col-span-2">What is weak (comma between each)
          <input key={weaknessTagsOf(p).join(',')} defaultValue={weaknessTagsOf(p).join(', ')} placeholder="No reels in 90 days, no lead form on the site" disabled={busy} className={field}
            onBlur={e => { const next = e.target.value.split(',').map(s => s.trim()).filter(Boolean); if (next.join(',') !== weaknessTagsOf(p).join(',')) void patch({ weakness_tags: next }) }} />
        </label>
        {area('audit_angle', 'Audit angle', 'What the audit will say they are missing, and why we can help', 2)}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          {!has('fit') && signal('fit', 'Strong fit for the tier')}
          {!has('weak_presence') && signal('weak_presence', 'Weak website or social')}
        </div>
      </section>

      {/* ── the assets and the outreach ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="Assets and outreach">
        <p className={`${H} sm:col-span-2`}>Audit assets and outreach</p>
        {text('loom_url', 'Private Loom or audit', 'loom.com/share/…')}
        {text('post_url', 'Public audit post', 'instagram.com/p/…')}
        {text('cta_url', 'Booking or CTA link', 'The tracked link in the message', true)}
        {/* TRACKED LINKS (the blueprint, §8): the address to paste into the DM or email — a click lands on this
            prospect's timeline, the first one as the intent signal, and a target at Outreach becomes a lead */}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2" data-tracked-links>
          <span className="text-[12px] font-semibold text-muted-foreground">Tracked links to paste</span>
          {TRACKED_KINDS.map(k => (
            <Button key={k} type="button" variant="outline" size="sm" disabled={!destinationFor(p, k)}
              title={destinationFor(p, k) ? trackedPath(p.id, k) : `Fill in the ${TRACKED_WORDS[k].label.toLowerCase()} link first`}
              onClick={() => void copyText(trackedLink(window.location.origin, p.id, k)).then(ok => ok
                ? toast.success(`Tracked ${TRACKED_WORDS[k].label.toLowerCase()} link copied — a click lands on this prospect`)
                : toast.error(`Could not copy — the link is ${trackedLink(window.location.origin, p.id, k)}`))}
              className="h-9 rounded-full px-3 text-[12px] font-semibold">
              <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden /> {TRACKED_WORDS[k].label}
            </Button>
          ))}
        </div>
        {when('outreach_at', 'Outreach sent')}
        <label className="flex flex-col gap-1 text-[12px] font-semibold">Channel
          <Select value={p.outreach_channel ?? 'none'} onValueChange={v => void patch({ outreach_channel: v === 'none' ? null : v })}>
            <SelectTrigger className="h-11 text-[14px] font-normal" aria-label="Outreach channel"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">Not sent yet</SelectItem>{OUTREACH_CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </label>
      </section>

      {/* ── the follow-up ── */}
      {p.outreach_at && (
        <section className="flex flex-col gap-2" aria-labelledby="acq-follow">
          <p id="acq-follow" className={H}>Follow-up — the system reminds, you write and send</p>
          <ul className="flex flex-col gap-1.5">
            {plan.map(s => (
              <li key={s.day} className={`flex flex-wrap items-center gap-2 rounded-inner border p-2.5 text-[13px] ${s.overdue ? 'border-accent-red/50 bg-tint-red' : 'border-border'} ${s.paused ? 'opacity-60' : ''}`}>
                <span className="font-semibold">Day {s.day} · {s.purpose}</span>
                <span className="text-muted-foreground">{s.how}</span>
                <span className="ml-auto text-[12px] text-muted-foreground">{s.done_at ? `done ${day(s.done_at)}` : s.paused ? 'paused — they replied' : s.due_at ? `${s.overdue ? 'was due' : 'due'} ${day(s.due_at)}` : ''}</span>
                {!s.done_at && !s.paused && s.day > 0 && s.day < 21 && (
                  <Button variant="outline" disabled={busy} onClick={() => void log('follow_up', `Day ${s.day} sent — ${s.purpose}`, `Day ${s.day} marked sent`)} className="h-9 rounded-full px-3 text-[12px] font-semibold">Mark sent</Button>
                )}
                <p className="basis-full text-[12px] text-muted-foreground">{s.action}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── what they did ── */}
      <section className="flex flex-col gap-2" aria-labelledby="acq-signals">
        <p id="acq-signals" className={H}>Log what they did — the score follows</p>
        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
          <textarea value={said} onChange={e => setSaid(e.target.value)} rows={2} placeholder="What they said, in their words (optional)" className={`${field} resize-y p-2.5`} aria-label="What they said" />
          <Button disabled={busy} onClick={async () => { if (await log('reply', said.trim() || null, 'Reply logged — follow-ups paused')) setSaid('') }} className="h-11 w-fit rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">They replied +20</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {signal('link_click', 'Clicked the audit link')}
          {signal('asset_engaged', 'Watched the audit')}
          {signal('call_booked', 'Booked a call')}
          {signal('reminder_opened', 'Opened a reminder')}
          {signal('delayed', 'Rescheduled or delayed')}
          <Button variant="outline" disabled={busy} onClick={() => void log('not_interested', said.trim() || null, 'Closed — not interested. We stop chasing.')} className="h-11 rounded-full px-3 text-[12px] font-semibold text-accent-red-deep">Not interested</Button>
        </div>
      </section>

      {/* ── the sale ── */}
      <section className="grid gap-3 sm:grid-cols-2" aria-label="The sale">
        <p className={`${H} sm:col-span-2`}>The call, the proposal, the deposit, the contract</p>
        {when('call_at', 'Discovery call')}
        {text('next_action', 'Next action', 'What happens next, in a line')}
        {area('call_notes', 'Notes from the call', 'Service fit, budget fit, the next step')}
        {text('proposal_url', 'Proposal link')}
        {amount('deal_value', 'Proposal value')}
        {text('invoice_ref', 'Deposit invoice number or link')}
        {amount('deposit_amount', 'Deposit amount')}
        {when('deposit_paid_at', 'Deposit paid')}
        {text('contract_url', 'Contract link')}
        {when('signed_at', 'Contract signed')}
      </section>

      {/* ── the timeline ── */}
      <section className="flex flex-col gap-2" aria-labelledby="acq-timeline">
        <div className="flex flex-wrap items-center gap-2">
          <p id="acq-timeline" className={`${H} min-w-0 flex-1`}>Timeline — the score is the sum of these</p>
          <Button variant="outline" disabled={busy} onClick={() => void check()} className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> {busy ? 'Checking…' : 'Check the inboxes now'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void research()} className="h-11 rounded-full px-4 text-[13px] font-semibold">
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden /> {busy ? 'Working…' : 'Research this business'}
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          The agent reads the emails and Instagram messages with this business every 30 minutes and adds what is new.{(p as { agent_checked_at?: string | null }).agent_checked_at ? ` Last looked ${stamp(String((p as { agent_checked_at?: string | null }).agent_checked_at))}.` : ' It has not looked yet.'}
        </p>
        {/* WHAT THE AGENT FOUND AND WILL NOT DECIDE ALONE (acq-agent-core.ts, rule 3) */}
        {events.filter(isOpenFinding).map(e => (
          <div key={e.id} role="status" className="flex flex-col gap-2 rounded-inner border border-border bg-tint-amber p-3 text-[13px]">
            <p><span className="font-semibold">Found — is this right? {isAcqEventKind(e.kind) ? ACQ_EVENT_KINDS[e.kind].label : e.kind}</span><span className="block whitespace-pre-wrap">{e.detail}</span></p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void answer(e.id, true)} className="h-11 rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90"><Check className="mr-1.5 h-4 w-4" aria-hidden /> Confirm</Button>
              <Button variant="outline" disabled={busy} onClick={() => void answer(e.id, false)} className="h-11 rounded-full px-4 text-[13px] font-semibold">Not this</Button>
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note…" className={field} aria-label="A note for the timeline"
            onKeyDown={async e => { if (e.key === 'Enter' && note.trim()) { e.preventDefault(); if (await log('note', note.trim(), 'Note added')) setNote('') } }} />
          <Button variant="outline" disabled={busy || !note.trim()} onClick={async () => { if (await log('note', note.trim(), 'Note added')) setNote('') }} className="h-11 shrink-0 rounded-full px-4 text-[13px] font-semibold">Add</Button>
        </div>
        <ol className="flex flex-col">
          {[...events].filter(e => !isOpenFinding(e) && !e.dismissed_at).sort((a, b) => String(b.at).localeCompare(String(a.at))).map(e => (
            <li key={e.id} className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)_auto] gap-3 border-b border-border py-2.5 text-[13px]">
              <span className="font-mono text-[12px] text-muted-foreground">{stamp(e.at)}</span>
              <span><span className="font-semibold">{isAcqEventKind(e.kind) ? ACQ_EVENT_KINDS[e.kind].label : e.kind}</span>{e.source === 'agent' ? <span className="ml-1.5 rounded-full bg-foreground/10 px-1.5 py-0.5 text-[11px] font-semibold">agent</span> : null}{e.detail ? <span className="block whitespace-pre-wrap text-muted-foreground">{e.detail}</span> : null}</span>
              <span className={`font-semibold ${Number(e.points) > 0 ? 'text-accent-green-deep' : Number(e.points) < 0 ? 'text-accent-red-deep' : 'text-muted-foreground'}`}>{Number(e.points) ? `${Number(e.points) > 0 ? '+' : ''}${e.points}` : ''}</span>
            </li>
          ))}
          {events.length === 0 && <li className="py-2 text-[13px] text-muted-foreground">Nothing has happened yet.</li>}
        </ol>
      </section>

      {area('notes', 'Notes on the prospect', 'Anything the next person should know')}

      {mayDeleteProspect(viewer) && (
        <Button variant="ghost" disabled={busy} onClick={remove} className="h-11 w-fit rounded-full px-4 text-[13px] font-semibold text-muted-foreground hover:text-accent-red-deep"><Trash2 className="mr-1.5 h-4 w-4" aria-hidden /> Delete this prospect</Button>
      )}
    </div>
  )
}
