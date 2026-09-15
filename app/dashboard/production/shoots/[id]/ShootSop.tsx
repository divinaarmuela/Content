'use client'

import BulletArea from './BulletArea'
import ShootFor from '../../ShootFor'
import ScriptsEditor from './ScriptsEditor'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Circle, FileDown, Link as LinkIcon, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CallTimePicker from '../../CallTimePicker'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { groupPeople, personWords } from '../../../../lib/people-groups-core'
import {
  BRIEF_ITEMS, FOOTAGE_ONLY_WORDS, STAGE_LABEL, STAGE_STRIP, ackState, briefChecklist, briefIsLate, briefItemFilled, briefItemSource,
  REVIEW_DEFAULT_QUALITY, clientPlanWords, clientShareReady, clockWords, goReady, isFootageOnly, nextStepWords, overrideWords, planReviewPassed, reviewWords, shootStage, stageHappened, stageIndex, stageMove,
  stampLines, stampWords,
  type BriefItemKey, type MoveRole, type NameOf, type ShootStage, type SopShoot,
} from '../../../../lib/shoot-sop-core'
import { newLineId, planLines, plannedCount, shootCardId } from '../../../../lib/deliverable-group-core'
import type { ShotRow } from '../../../../lib/batch-brief-core'
import Chip from '../../../ui/Chip'
import LocationSearch from './LocationSearch'

/**
 * THE SHOOT PAGE, AS THE SHOOT BRIEF SOP §3 READS (rebuilt 13 Sep 2026 —
 * the owner: "revamp this whole shoot page, make sure it's easy to use").
 *
 *   StageStrip    the six stages and ONE "Next: …" line
 *   PlanParts     THE SHOOT PLAN — the nine parts, each ticked as it is
 *                 filled, every field INSIDE its row (the deliverables, the
 *                 shot list, the date, call time and location included)
 *   WherePanel    WHERE IT IS — the stage, the late line, the two ticks, one
 *                 next button (greyed with its reason), "Share the plan with
 *                 the client", the footage folder, and every stamp with who
 *                 and when
 *   PeoplePanel   WHO IS ON THIS SHOOT — the editor, the crew, who has read
 *                 the plan (on their card or from their email)
 *   EditorCard    THE EDITOR'S CARD — one line and "Open on Editor"
 *   PortalPanel   CLIENT PORTAL — the switch, the PDF, the portal link
 *
 * Everyone who reaches this page may work it (the server refuses anyone
 * else), so nothing here is greyed by role — only by the SOP's rules, and
 * every greyed button says why in a line under it.
 */

export type ShootSopBatch = SopShoot & {
  title: string
  status?: string | null
  shot_list?: ShotRow[]
  scripts?: unknown
  planned_deliverables?: unknown[]
  location?: string | null
  deliver_only?: boolean | null
}
export type CrewRow = { id: string; name: string; role: string | null; acknowledged_at: string | null }
export type TeamRow = { id: string; name: string; role: string }

const H = 'font-mono text-[12px] uppercase tracking-widest text-muted-foreground'
const primaryBtn = 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90'
const outlineBtn = 'h-11 rounded-full px-4 text-[14px] font-semibold'

/* ── the flow, on the page ─────────────────────────────────────────────── */

export function StageStrip({ batch, today, role, itemCount, planReviewRequired = false }: {
  batch: SopShoot
  today: string
  role: MoveRole
  itemCount: number
  /** the quality gate applies — the strip shows the Quality review step */
  planReviewRequired?: boolean
}) {
  const planReview = { required: planReviewRequired }
  const stage = shootStage(batch, today, { planReview: planReviewRequired })
  // a plan the gate does not apply to never has the Quality review step
  const strip = planReviewRequired ? STAGE_STRIP : STAGE_STRIP.filter(s => s.key !== 'quality_review')
  const at = strip.findIndex(s => s.key === stage)
  const line = nextStepWords(batch, today, { itemCount, role, planReview })
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-3">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="Where this shoot is">
        {strip.map((s, i) => {
          const past = i < at
          const done = past && stageHappened(batch, s.key, today)
          const skipped = past && !done
          const now = i === at
          return (
            <li key={s.key} className="flex items-center gap-1">
              <span
                aria-current={now ? 'step' : undefined}
                className={
                  'inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold ' +
                  (now ? 'bg-foreground text-background' : done ? 'text-foreground' : 'text-muted-foreground')
                }
              >
                {done && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
                {s.label}
                <span className="sr-only">{now ? ' — now' : done ? ' — done' : skipped ? ' — skipped' : ' — to come'}</span>
              </span>
              {i < strip.length - 1 && <span aria-hidden className="text-muted-foreground">›</span>}
            </li>
          )
        })}
      </ol>
      <p className="text-[14px]" role="status">{line}</p>
    </div>
  )
}

/* ── the nine parts, every field in its row ────────────────────────────── */

const Tick = ({ on }: { on: boolean }) => on
  ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-green text-ink" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
  : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground" aria-hidden><Circle className="h-3 w-3" /></span>

export function PlanParts({ batch, itemCount, booked, onPatch, onShots, team }: {
  batch: ShootSopBatch
  itemCount: number
  /** a booked date moves only through "Change date" with a reason */
  booked: boolean
  onPatch: (field: string, value: unknown) => Promise<boolean>
  /** the shot list saves through a coalescer — instant on screen, one request */
  onShots: (next: ShotRow[]) => void
  team?: readonly { id: string; name: string; role: string }[]
}) {
  const list = briefChecklist(batch, { itemCount })
  const [newLine, setNewLine] = useState('')
  const planned = planLines(batch.planned_deliverables)
  const shots = batch.shot_list ?? []
  const save = (field: keyof ShootSopBatch) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value.trim()
    if (v !== String(batch[field] ?? '').trim()) void onPatch(field, v || null)
  }
  const row = (key: BriefItemKey, field: React.ReactNode) => {
    const item = BRIEF_ITEMS.find(i => i.key === key)!
    const on = briefItemFilled(batch, key, { itemCount })
    const fromCanvas = briefItemSource(batch, key, { itemCount }) === 'canvas'
    return (
      <div key={key} className="flex gap-3">
        <Tick on={on} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[15px] font-semibold">{item.label}</span>
            <span className="text-[12px] text-muted-foreground">{item.hint}</span>
            {fromCanvas && <Chip tone="green" className="text-[12px]">from the canvas</Chip>}
            <span className="sr-only">{on ? (fromCanvas ? 'filled in, on the canvas' : 'filled in') : 'still to fill in'}</span>
          </div>
          {field}
        </div>
      </div>
    )
  }
  const area = (field: keyof ShootSopBatch, placeholder: string, rows = 2) => (
    <Textarea key={String(batch[field] ?? '')} defaultValue={String(batch[field] ?? '')} rows={rows}
      placeholder={placeholder} aria-label={placeholder} className="min-h-11 text-[15px]" onBlur={save(field)} />
  )
  const line = (field: keyof ShootSopBatch, placeholder: string) => (
    <Input key={String(batch[field] ?? '')} defaultValue={String(batch[field] ?? '')}
      placeholder={placeholder} aria-label={placeholder} className="h-11 text-[15px]" onBlur={save(field)} />
  )
  const addLine = async () => {
    const title = newLine.trim()
    if (!title) return
    setNewLine('')
    await onPatch('planned_deliverables', [...planned, { id: newLineId(), title }])
  }
  const finals = plannedCount(batch.planned_deliverables)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={H}>The shoot plan</p>
          <Chip tone={list.complete ? 'green' : 'amber'} className="ml-auto"><span role="status">{list.words}</span></Chip>
        </div>
        <p className="-mt-2 text-[13px] text-muted-foreground">
          Nine parts. The plan is shared with the team 7 days before the shoot, and nothing moves forward until all nine are filled in.
        </p>

        {row('objective', area('objective', 'What this shoot is meant to achieve, and which pillar or campaign it serves'))}

        {row('deliverables', (
          <div className="flex flex-col gap-1.5">
            {planned.length === 0 && itemCount === 0 && (
              <p className="text-[13px] text-muted-foreground">Nothing listed yet. One line for each thing coming out — 5 reels, 1 long-form, 1 photo set. The editor gets one card for the whole shoot.</p>
            )}
            {planned.map((l, i) => (
              <div key={l.id} className="flex items-center gap-1.5">
                <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">{i + 1}</span>
                <Input key={`${l.id}:${l.title}`} defaultValue={l.title} aria-label={`Line ${i + 1} of what is coming out`}
                  className="h-11 min-w-0 flex-1 text-[15px]"
                  onBlur={e => {
                    const title = e.target.value.trim()
                    if (title && title !== l.title) void onPatch('planned_deliverables', planned.map((x, j) => j === i ? { ...x, title } : x))
                  }} />
                <button type="button" aria-label={`Remove line ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent-red-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
                  onClick={() => void onPatch('planned_deliverables', planned.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="w-5 shrink-0 text-right font-mono text-[12px] text-muted-foreground">{planned.length + 1}</span>
              <Input value={newLine} placeholder="Add a line — e.g. 5 reels" aria-label="Add a line of what is coming out"
                className="h-11 min-w-0 flex-1 text-[15px]"
                onChange={e => setNewLine(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addLine() } }} />
              <Button variant="outline" className={outlineBtn} disabled={!newLine.trim()} onClick={() => void addLine()}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
            {(finals > 0 || itemCount > 0) && (
              <p className="text-[12px] text-muted-foreground">
                {finals > 0 ? `${finals} final${finals === 1 ? '' : 's'} expected` : ''}{finals > 0 && itemCount > 0 ? ' · ' : ''}{itemCount > 0 ? `${itemCount} card${itemCount === 1 ? '' : 's'} on Editor` : ''}
              </p>
            )}
          </div>
        ))}

        {row('shot_list', (
          <div className="flex flex-col gap-1.5">
            {shots.length === 0 && <p className="text-[13px] text-muted-foreground">No shots yet. Scene by scene, what needs to be captured on the day.</p>}
            {shots.map((shot, i) => (
              <div key={shot.id} className="flex items-center gap-2">
                <input type="checkbox" checked={shot.done} aria-label={`Shot ${i + 1} captured`}
                  onChange={e => onShots(shots.map((s, j) => j === i ? { ...s, done: e.target.checked } : s))}
                  className="h-5 w-5 shrink-0 accent-[var(--dbx-blue)]" />
                {/* keyed by the shot's id ONLY — keying on the text remounted
                    the field on every echo and dropped focus mid-word */}
                <Input key={shot.id} defaultValue={shot.text} aria-label={`Shot ${i + 1}`}
                  className="h-11 min-w-0 flex-1 text-[15px]"
                  onBlur={e => {
                    const v = e.target.value.trim()
                    if (v !== shot.text) onShots(v === '' ? shots.filter((_, j) => j !== i) : shots.map((s, j) => j === i ? { ...s, text: v } : s))
                  }} />
                <button type="button" aria-label={`Remove shot ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent-red-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue"
                  onClick={() => onShots(shots.filter((_, j) => j !== i))}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" className={`${outlineBtn} w-fit`}
              onClick={() => onShots([...shots, { id: Math.random().toString(36).slice(2, 10), text: 'New shot', done: false }])}>
              <Plus className="h-4 w-4" aria-hidden /> Add shot
            </Button>
          </div>
        ))}

        {row('script', (
          <div className="flex flex-col gap-3">
            {/* BULLET POINTS (the owner, 15 Sep 2026: "make the script and talking
                points bullet points — currently the box is just a box") */}
            <BulletArea value={batch.script} placeholder="The script or the talking points, one point per line" rows={4}
              onSave={v => void onPatch('script', v || null)} />
            {/* THE SCRIPTS, ONE PER VIDEO (the owner, 15 Sep 2026: "there will be
                multiple scripts per brief — a script name, the body, then add
                another"): each prints as its own section on the PDF and on
                the editor's card */}
            <p className="text-[12px] font-semibold">Scripts</p>
            <ScriptsEditor scripts={batch.scripts} onSave={v => void onPatch('scripts', v)} disabled={busy} />
          </div>
        ))}

        {row('when_where', (
          <div className="grid gap-2 sm:grid-cols-[180px_250px_minmax(0,1fr)]">
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Shoot date
              <Input type="date" key={batch.shoot_date ?? ''} defaultValue={batch.shoot_date ?? ''} disabled={booked}
                className="h-11 font-mono text-[14px] font-normal"
                onBlur={e => { if ((e.target.value || null) !== (batch.shoot_date ?? null)) void onPatch('shoot_date', e.target.value || null) }} />
              <span className="text-[12px] font-normal text-muted-foreground">{batch.shoot_date ? stampWords(batch.shoot_date) : 'Read back in words once set'}{booked ? ' · booked — use Change date' : ''}</span>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Call time
              <CallTimePicker value={batch.call_time} onSave={v => { if (v !== (batch.call_time ?? '')) void onPatch('call_time', v) }} />
              <span className="text-[12px] font-normal text-muted-foreground">{String(batch.call_time ?? '').trim() ? `Everyone on set by ${String(batch.call_time).trim()}` : 'When everyone has to be on set, ready'}</span>
            </label>
            <div className="flex flex-col gap-1 text-[12px] font-semibold">
              Location
              <LocationSearch value={batch.location ?? ''} onSave={v => void onPatch('location', v)} />
            </div>
          </div>
        ))}

        {row('talent', line('talent', 'Who is on camera, confirmed and briefed'))}
        {row('props', area('props_wardrobe', 'What is needed and who is bringing it'))}
        {row('editor', (
          <div className="flex flex-col gap-1.5">
            {area('editor_priorities', 'What to cut first, and what the video is meant to achieve')}
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Editor deadline
              <Input type="date" key={batch.edit_deadline ?? ''} defaultValue={batch.edit_deadline ?? ''}
                className="h-11 max-w-[200px] font-mono text-[14px] font-normal" onBlur={save('edit_deadline')} />
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/* ── where it is, and the one next move ────────────────────────────────── */

export function WherePanel({ batch, role, viewerId, today, itemCount, busy, nameOf, clientEmail, onPatch, onMove, onShareClient, onAskReview, team, planReviewRequired, viewerIsReviewer, onPlanReview, portalToken = null }: {
  batch: ShootSopBatch
  /** the client's portal token — the links to copy once the plan is on it */
  portalToken?: string | null
  role: MoveRole
  viewerId: string
  today: string
  itemCount: number
  busy: boolean
  nameOf: NameOf
  /** the client's email on file — null means the share cannot email anyone */
  clientEmail: string | null
  onPatch: (field: string, value: unknown) => Promise<boolean>
  onMove: (to: ShootStage, opts?: { reason?: string }) => Promise<void>
  onShareClient: () => Promise<void>
  /** "Ask for a review": the ids to ask, or [] for the account managers on the client */
  onAskReview?: (to: string[]) => Promise<void>
  team?: readonly { id: string; name: string; role: string }[]
  /** THE QUALITY GATE (13 Sep 2026): this plan needs the quality checker's
   *  pass before Go — worked out by the route from who wrote and holds it */
  planReviewRequired?: boolean
  /** the viewer answers the gate: a quality checker, or a super admin */
  viewerIsReviewer?: boolean
  onPlanReview?: (pass: boolean, note?: string) => Promise<void>
}) {
  const gate = planReviewRequired === true
  const stage = shootStage(batch, today, { planReview: gate })
  const [reviewer, setReviewer] = useState('')
  const [pickOpen, setPickOpen] = useState(false)
  const [sendBack, setSendBack] = useState(false)
  const [sendBackNote, setSendBackNote] = useState('')
  const late = briefIsLate(batch, today)
  const clock = clockWords(batch, today)
  const [reason, setReason] = useState('')
  const planReview = { required: gate }
  const go = goReady(batch, { itemCount, role, overrideReason: reason, planReview })
  const can = (to: ShootStage) => stageMove(batch, to, { role, today, checklist: { itemCount }, overrideReason: reason, planReview, reviewer: viewerIsReviewer === true }, 'now', viewerId)
  const askOverride = stage === 'shared' && role === 'super_admin' && goReady(batch, { itemCount, planReview }).needsOverride
  const [folder, setFolder] = useState(batch.footage_url ?? '')
  // ONE next button: the stage's own move
  const next: { to: ShootStage; label: string } | null =
    // a gated plan's one action while drafting is the review row (Ask for a
    // review); Share appears once the quality checker passed it
    stage === 'drafting' && gate && !planReviewPassed(batch) ? null
    : stage === 'drafting' || (stage === 'quality_review' && planReviewPassed(batch)) ? { to: 'shared', label: 'Share the plan with the team' }
    // the calendar carried it on before it was shared (14 Sep 2026): the
    // review row is the action while the gate is open, then Share, then Footage
    : (stage === 'reminder_sent' || stage === 'shoot_day') && !batch.brief_shared_at && gate && !planReviewPassed(batch) ? null
    : (stage === 'reminder_sent' || stage === 'shoot_day') && !batch.brief_shared_at ? { to: 'shared', label: 'Share the plan with the team' }
    : stage === 'shared' ? { to: 'confirmed', label: askOverride ? 'Go anyway (super admin)' : 'Confirm — it is go' }
    : stage === 'confirmed' ? { to: 'reminder_sent', label: 'Reminder sent to everyone' }
    : stage === 'reminder_sent' || stage === 'shoot_day' ? { to: 'footage_handed', label: 'Footage is in' }
    : null
  const check = next ? can(next.to) : null
  // THE FOLDER BOX FOLLOWS THE BUTTON (the owner, 14 Sep 2026: "why is the
  // bar here when the Footage is in button is not there?"): it appears only
  // when "Footage is in" is the step in front of you, or once it is in
  const folderShown = next?.to === 'footage_handed' || stage === 'footage_handed'
  const shareReady = clientShareReady(batch, { itemCount })
  const clientLine = clientPlanWords(batch)
  const lines = stampLines(batch, nameOf, { planReview: gate })
  // a shoot typed by name on the Editor page: already shot, no plan — no
  // ticks, no Go, no share; the footage folder and the log still apply
  const footageOnly = isFootageOnly(batch)

  return (
    <Card className={late ? 'border-accent-red/40 bg-tint-red' : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={H}>Where it is</p>
          <Chip tone={stage === 'footage_handed' ? 'green' : stage === 'shoot_day' ? 'amber' : 'ink'} className="ml-auto">{STAGE_LABEL[stage]}</Chip>
        </div>
        {clock && (
          <p className={`text-[15px] font-semibold ${late ? 'text-accent-red-deep' : ''}`} role={late ? 'alert' : undefined}>{clock}</p>
        )}
        {overrideWords(batch) && <Chip tone="amber" className="w-fit">{overrideWords(batch)}</Chip>}
        {footageOnly && <Chip tone="surface" className="w-fit">{FOOTAGE_ONLY_WORDS}</Chip>}

        {stage !== 'footage_handed' && (
          <div className="flex flex-col gap-1">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--dbx-blue)]" checked={!!batch.aligned_at} disabled={busy}
                onChange={e => void onPatch('aligned', e.target.checked)} />
              <span>Aligned with the strategist or creative director{batch.aligned_at && <span className="text-[12px] text-muted-foreground"> · {nameOf(batch.aligned_by) ?? 'the team'}, {stampWords(batch.aligned_at)}</span>}</span>
            </label>
            {/* ASK FOR A REVIEW (13 Sep 2026): whoever wrote the plan asks
                the account managers, or one person, to look at it; the
                tick above is their sign-off. THE QUALITY GATE: a plan written
                or held by anyone but a super admin goes to the quality
                checker, who passes it or sends it back — Go waits on that. */}
            {/* THE QUALITY REVIEW, ONE STATE AT A TIME (the owner, 13 Sep 2026:
                "again, you are making this super confusing"). Not sent ·
                with the checker · passed. Only a plan the gate applies to
                draws any of it. */}
            {/* …and only until Go: a confirmed shoot's plan is past its review
                (the owner, 14 Sep 2026: "make sure no quality review popover
                is shown there") */}
            {gate && !batch.go_at && (() => {
              const passed = planReviewPassed(batch)
              const asked = !passed && !!batch.review_asked_at
              const askedTo = (Array.isArray(batch.review_asked_to) ? batch.review_asked_to : []).map(id => nameOf(String(id)) ?? 'the quality checker')
              const withWho = askedTo.length > 0 ? askedTo.join(', ') : 'the quality checker'
              const sentBack = !asked && !passed && batch.plan_sent_back_note
                ? `Sent back by ${nameOf(batch.plan_sent_back_by) ?? 'the quality checker'}: ${batch.plan_sent_back_note}` : null
              return (
                <div className="flex flex-col gap-1.5" data-plan-review>
                  <p className="flex min-h-11 items-center gap-3 text-[14px]">
                    <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${passed ? 'border-accent-green bg-accent-green text-ink' : 'border-border'}`}>{passed ? '✓' : ''}</span>
                    <span>
                      {passed
                        ? <>Quality review passed by {nameOf(batch.plan_reviewed_by) ?? 'the team'}, {stampWords(batch.plan_reviewed_at)}</>
                        : asked
                          ? <>With {withWho} for quality review since {stampWords(batch.review_asked_at)}</>
                          : 'Quality review — not sent yet'}
                    </span>
                  </p>
                  {/* NOT SENT YET: one button; a small link opens the picker */}
                  {!asked && !passed && onAskReview && (
                    <div className="flex flex-col gap-2 pl-8" data-review-state="not-sent">
                      {sentBack && <p className="rounded-inner border border-border bg-tint-amber p-2.5 text-[13px]" role="status">{sentBack}</p>}
                      {pickOpen && (
                        <select value={reviewer} onChange={e => setReviewer(e.target.value)} aria-label="Who should review the plan"
                          className="h-11 min-w-0 rounded-inner border border-border bg-surface px-2 text-[13px]">
                          <option value="">{REVIEW_DEFAULT_QUALITY}</option>
                          {(team ?? []).filter(t => t.id !== viewerId && t.role !== 'client').map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </select>
                      )}
                      <div className="flex flex-wrap items-center gap-3">
                        <Button className={primaryBtn} disabled={busy} onClick={() => void onAskReview(reviewer ? [reviewer] : [])}>
                          Send the plan for quality review
                        </Button>
                        {!pickOpen && (
                          <button type="button" onClick={() => setPickOpen(true)} className="min-h-11 text-[13px] underline underline-offset-4">or pick a person</button>
                        )}
                      </div>
                    </div>
                  )}
                  {/* WITH THE CHECKER: the reviewer's two answers; a "Send again" link for the asker */}
                  {asked && (
                    <div className="flex flex-col gap-2 pl-8" data-review-state="asked">
                      {viewerIsReviewer && onPlanReview && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button className={primaryBtn} disabled={busy} onClick={() => void onPlanReview(true)}>Pass the plan</Button>
                          {!sendBack && (
                            <Button variant="outline" className={outlineBtn} disabled={busy} onClick={() => setSendBack(true)}>Send back with a note</Button>
                          )}
                        </div>
                      )}
                      {viewerIsReviewer && onPlanReview && sendBack && (
                        <div className="flex flex-col gap-2 rounded-inner border border-border p-3">
                          <label htmlFor="plan-send-back" className="text-[13px] font-semibold">What should change? One line.</label>
                          <Input id="plan-send-back" value={sendBackNote} onChange={e => setSendBackNote(e.target.value)} maxLength={2000}
                            placeholder="The objective does not say which pillar this serves" className="h-11 text-[15px] font-normal" />
                          <div className="flex items-center gap-2">
                            <Button className={primaryBtn} disabled={busy || !sendBackNote.trim()}
                              onClick={async () => { await onPlanReview(false, sendBackNote.trim()); setSendBack(false); setSendBackNote('') }}>Send back</Button>
                            <Button variant="ghost" className={outlineBtn} onClick={() => { setSendBack(false); setSendBackNote('') }}>Cancel</Button>
                          </div>
                        </div>
                      )}
                      {onAskReview && batch.review_asked_by === viewerId && (
                        <button type="button" disabled={busy} onClick={() => void onAskReview([])} className="min-h-11 w-fit text-[13px] underline underline-offset-4">Send again</button>
                      )}
                    </div>
                  )}
                  {/* PASSED: nothing to press; a super admin can take it back */}
                  {passed && onPlanReview && role === 'super_admin' && (
                    <div className="pl-8" data-review-state="passed">
                      <button type="button" disabled={busy} onClick={() => void onPlanReview(false, 'Pass taken back')} className="min-h-11 text-[13px] underline underline-offset-4">Take the pass back</button>
                    </div>
                  )}
                </div>
              )
            })()}
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--dbx-blue)]" checked={!!batch.client_confirmed_at} disabled={busy}
                onChange={e => void onPatch('client_confirmed', e.target.checked)} />
              <span>Location confirmed{batch.client_confirmed_at && <span className="text-[12px] text-muted-foreground"> · {nameOf(batch.client_confirmed_by) ?? 'the team'}, {stampWords(batch.client_confirmed_at)}</span>}</span>
            </label>
          </div>
        )}

        {askOverride && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Why is it going ahead late? Ops is told, with your reason.
            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
              placeholder="One line — the client moved the date, the crew is already booked…"
              className="h-11 text-[15px] font-normal" aria-label="Reason for going ahead late" />
          </label>
        )}

        {next && check && (
          <div className="flex flex-col gap-1">
            <Button className={primaryBtn} disabled={busy || !check.ok}
              onClick={() => void onMove(next.to, askOverride ? { reason: reason.trim() } : undefined)}>
              {next.label}
            </Button>
            {!check.ok && <p className="text-[12px] text-muted-foreground" role="status">{check.reason}</p>}
            {check.ok && stage === 'shared' && !go.ok && <p className="text-[12px] text-muted-foreground">{go.reasons[0]}</p>}
          </div>
        )}
        {stage === 'footage_handed' && !footageOnly && (
          <p className="text-[13px]">Footage should be in — the editor has been told. The work is on the Editor page{batch.edit_deadline ? `, due ${stampWords(batch.edit_deadline)}` : ''}.</p>
        )}
        {footageOnly && (
          <p className="text-[13px] text-muted-foreground">This shoot was typed in from the Editor page — it was never planned here, so there is nothing to confirm. Its cards are on the Editor page.</p>
        )}
        {/* THE FOLDER BOX SITS UNDER THE BUTTON THAT NEEDS IT (the owner, 14 Sep
            2026: "footage link, why is it under there?") */}
        {folderShown && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Footage folder
            <Input
              key={batch.footage_url ?? ''}
              value={folder}
              onChange={e => setFolder(e.target.value)}
              onBlur={() => { const v = folder.trim(); if (v !== (batch.footage_url ?? '')) void onPatch('footage_url', v || null) }}
              placeholder="https://www.dropbox.com/… or https://drive.google.com/…"
              className="h-11 text-[15px] font-normal"
              aria-label="Footage folder link"
              inputMode="url"
            />
          </label>
        )}

        {/* THE CLIENT, IN ONE PLACE (the owner, 13 Sep 2026: "share button to
            client should be named differently, and there's another Client
            portal card at the bottom — confusing"). Not on the portal: one
            button puts it there. On the portal: the links to send and the
            way to take it off. No email is ever sent to a client. */}
        {/* DELIVERY ONLY (the owner, 14 Sep 2026: "when we finish a shoot, how
            can we set it up for only delivery — we won't be sending to a
            scheduler"): one switch; every card on the shoot takes the word,
            and the cards the plan makes are born with it */}
        {(role === 'account_manager' || role === 'super_admin' || role === 'general') && (
          <label className="flex min-h-11 w-fit cursor-pointer items-start gap-2 border-t border-border pt-3 text-[13px]" data-deliver-only>
            <input type="checkbox" className="mt-1 h-4 w-4 accent-foreground" checked={batch.deliver_only === true} disabled={busy}
              onChange={e => void onPatch('deliver_only', e.target.checked)} />
            <span>
              <span className="font-semibold">Delivery only</span> — the client posts these themselves. Every card on this shoot ends at approval; nothing goes to a scheduler.
            </span>
          </label>
        )}
        {batch.status !== 'wrapped' && !footageOnly && (
          <ClientBlock batch={batch} portalToken={portalToken} busy={busy} shareReady={shareReady} clientLine={clientLine}
            onShareClient={onShareClient} onPatch={onPatch} />
        )}


        {/* who did what, and when */}
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <p className={H}>What happened</p>
          <ul className="flex flex-col gap-1" aria-label="Who did what, and when">
            {lines.map(l => (
              <li key={l.key} className={`flex gap-2 text-[13px] ${l.done ? '' : 'text-muted-foreground'}`}>
                {/* a tick for what happened; nothing for what has not — the dots read
                    as strays (the owner, 14 Sep 2026) */}
                <span aria-hidden className="w-4 shrink-0 text-center">{l.done ? '✓' : ''}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── who is on the shoot ───────────────────────────────────────────────── */

export function PeoplePanel({ batch, crew, team, busy, onPatch, onUnack, viewerId, onAck, onResend }: {
  batch: ShootSopBatch
  crew: CrewRow[]
  team: TeamRow[]
  busy: boolean
  onPatch: (field: string, value: unknown) => Promise<boolean>
  onUnack: (userId: string) => Promise<void>
  /** the viewer, so their own row carries "I've read the plan" (14 Sep 2026:
   *  a super admin or AM on set acknowledges here, like everyone else) */
  viewerId?: string
  onAck?: () => Promise<void>
  /** "Send the plan again" to whoever has not read it (14 Sep 2026) */
  onResend?: () => Promise<void>
}) {
  const ack = ackState(batch)
  // the editor picker: editors first, then the managers who also cut
  // (the owner, 13 Sep 2026: "can an account manager / super admin get the
  // editing feature?" — yes), each under their own header
  const editorGroups = groupPeople(team.filter(t => ['editor', 'account_manager', 'super_admin'].includes(t.role)), 'editor')
  const crewIds = Array.isArray(batch.crew_ids) ? batch.crew_ids.map(String) : []
  const addable = team.filter(t => !crewIds.includes(t.id) && t.id !== batch.editor_id)
  const [adding, setAdding] = useState('')

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className={H}>Who is on this shoot</p>
          {ack.total > 0 && <Chip tone={ack.complete ? 'green' : 'amber'} className="ml-auto"><span role="status">{ack.words}</span></Chip>}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Assigned to: <span className="text-foreground">{crew.find(c => c.id === batch.owner_id)?.name ?? team.find(t => t.id === batch.owner_id)?.name ?? 'nobody yet'}</span>
        </p>

        <label className="flex flex-col gap-1 text-[12px] font-semibold">
          Editor: who edits the footage after the shoot
          <Select value={batch.editor_id ?? 'none'} onValueChange={v => void onPatch('editor_id', v === 'none' ? null : v)}>
            <SelectTrigger className="h-11 text-[15px] font-normal" aria-label="Editor"><SelectValue placeholder="Pick the editor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not picked yet</SelectItem>
              {editorGroups.map(g => (
                <SelectGroup key={g.role}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.people.map(e => <SelectItem key={e.id} value={e.id}>{personWords(e)}</SelectItem>)}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </label>

        <ul className="flex flex-col gap-1.5" aria-label="People on the shoot">
          {crew.length === 0 && <li className="text-[13px] text-muted-foreground">Nobody on the day yet. Add the videographer, the presenter and anyone else on set.</li>}
          {crew.map(c => (
            <li key={c.id} className="flex min-h-11 items-center gap-2 text-[14px]">
              {c.acknowledged_at
                ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-green text-ink" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {c.name}{c.id === batch.editor_id && <span className="text-muted-foreground"> · editor</span>}
                <span className="sr-only">{c.acknowledged_at ? ', has read the plan' : ', has not read the plan yet'}</span>
              </span>
              {!c.acknowledged_at && c.id === viewerId && onAck ? (
                <Button className="h-9 rounded-full px-3 text-[13px] font-semibold" disabled={busy} onClick={() => void onAck()}>
                  I’ve read the plan
                </Button>
              ) : (
                <span className="text-[12px] text-muted-foreground">{c.acknowledged_at ? `read it ${stampWords(c.acknowledged_at) ?? ''}` : 'not yet'}</span>
              )}
              {c.acknowledged_at && (
                <button type="button" onClick={() => void onUnack(c.id)} disabled={busy}
                  className="min-h-11 rounded-full px-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                  Undo
                </button>
              )}
              {c.id !== batch.editor_id && (
                <button type="button" aria-label={`Take ${c.name} off the shoot`} disabled={busy}
                  onClick={() => void onPatch('crew_ids', crewIds.filter(id => id !== c.id))}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent-red-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {addable.length === 0 && (
          <p className="text-[13px] text-muted-foreground">Everyone on the team is already on this shoot. New people are added on the Team page.</p>
        )}
        {addable.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-semibold">
              Crew on the day: videographer, presenter, anyone on set
              <Select value={adding} onValueChange={v => setAdding(v ?? '')}>
                <SelectTrigger className="h-11 text-[15px] font-normal" aria-label="Crew on the day"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                <SelectContent>
                  {groupPeople(addable, 'general').map(g => (
                    <SelectGroup key={g.role}>
                      <SelectLabel>{g.label}</SelectLabel>
                      {g.people.map(t => <SelectItem key={t.id} value={t.id}>{personWords(t)}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <Button variant="outline" className={outlineBtn} disabled={!adding || busy}
              onClick={async () => { const ok = await onPatch('crew_ids', [...crewIds, adding]); if (ok) setAdding('') }}>
              Add
            </Button>
          </div>
        )}
        {batch.brief_shared_at && onResend && crew.some(c => !c.acknowledged_at) && (
          <Button variant="outline" className={`${outlineBtn} w-fit`} disabled={busy} onClick={() => void onResend()}>
            Send the plan again to whoever has not read it
          </Button>
        )}
        <p className="text-[12px] text-muted-foreground">Each person here is emailed the plan when it is shared. The editor presses “I’ve read the plan” on their card; the crew press the link in their email. The shoot is not confirmed until everyone has.</p>
      </CardContent>
    </Card>
  )
}

/* ── the editor's card ─────────────────────────────────────────────────── */

export function EditorCardPanel({ batch, items, editorName }: {
  batch: ShootSopBatch
  items: { id: string; title: string; status: string; work_kinds?: { slug?: string } | null }[]
  editorName: string | null
}) {
  const cards = items.filter(i => i.work_kinds?.slug !== 'shoot_brief')
  const one = cards.find(c => c.id === shootCardId(batch.id)) ?? cards[0] ?? null
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4">
        <p className={H}>The editor’s card</p>
        {one ? (
          <>
            <p className="text-[14px]">
              {editorName ? `${editorName} has the card` : 'The card is made — no editor named yet'}{batch.edit_deadline ? ` · due ${stampWords(batch.edit_deadline)}` : ''}{batch.footage_handed_at ? ' · footage in' : ' · footage after the shoot'}
            </p>
            <Button variant="outline" className={`${outlineBtn} w-fit`} asChild>
              <Link href={`/dashboard/editor?card=${one.id}`}>Open on Editor</Link>
            </Button>
          </>
        ) : (
          <p className="text-[13px] text-muted-foreground">Made when the plan is shared with the team, from the lines under Deliverables. The editor reads the plan and presses “I’ve read the plan” on it.</p>
        )}
      </CardContent>
    </Card>
  )
}

/* ── the client, in one place ──────────────────────────────────────────── */

export function ClientBlock({ batch, portalToken, busy, shareReady, clientLine, onShareClient, onPatch }: {
  batch: ShootSopBatch
  portalToken: string | null
  busy: boolean
  shareReady: { ok: boolean; reason?: string }
  clientLine: string | null
  onShareClient: () => Promise<void>
  onPatch: (field: string, value: unknown) => Promise<boolean>
}) {
  const [copied, setCopied] = useState<string | null>(null)
  const onPortal = !!batch.shared_with_client
  const pdf = (
    <Button variant="outline" className={outlineBtn} asChild>
      <a href={`/api/production/batches/${batch.id}/pdf`} download>
        <FileDown className="h-4 w-4" aria-hidden /> Download the plan PDF
      </a>
    </Button>
  )
  /* WHO THE SHOOT IS FOR, AND WHAT THEIR PORTAL CALLS IT (the owner, 15 Sep
   * 2026): the business, or one of the client's people — with the two
   * toggles that decide the plan's title on a person's portal. A person's
   * portal is their own link, minted the first time it is copied. */
  const forWho = (batch as { for_contact_id?: string | null }).for_contact_id ?? null
  const showBusiness = (batch as { portal_show_business?: boolean | null }).portal_show_business !== false
  const showPerson = (batch as { portal_show_person?: boolean | null }).portal_show_person !== false
  const portalLinkFor = async (): Promise<string> => {
    if (!forWho) return `${window.location.origin}/portal/${portalToken}`
    const res = await fetch(`/api/website/clients/${batch.client_id}/contacts/portal-link`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactId: forWho }),
    })
    const json = await res.json().catch(() => ({})) as { url?: string; error?: string }
    if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not make their link')
    return json.url
  }
  const forBlock = (
    <div className="flex flex-col gap-1.5">
      <p className="text-[12px] font-semibold">Who this shoot is for</p>
      <ShootFor clientId={batch.client_id} value={forWho ?? ''} onChange={v => void onPatch('for_contact_id', v || null)} disabled={busy} />
      {forWho && (
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--dbx-blue)]" checked={showBusiness} disabled={busy}
              onChange={e => void onPatch('portal_show_business', e.target.checked)} />
            Show the business name on their portal
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[var(--dbx-blue)]" checked={showPerson} disabled={busy}
              onChange={e => void onPatch('portal_show_person', e.target.checked)} />
            Show their name on their portal
          </label>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">{forWho ? 'This plan lands on that person’s own portal, not the business’s.' : 'This plan lands on the business’s portal.'}</p>
    </div>
  )
  if (!onPortal) {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {forBlock}
        <p className="text-[12px] font-semibold">The client</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={outlineBtn} disabled={busy || !shareReady.ok} onClick={() => void onShareClient()}>
            Put the plan on the client portal
          </Button>
          {pdf}
        </div>
        <p className="text-[12px] text-muted-foreground">
          {!shareReady.ok ? shareReady.reason : 'No email is sent — you copy the link and send it yourself once it is on.'}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3" data-client-on-portal>
      {forBlock}
      <p className="text-[14px] font-semibold" role="status">{clientLine ?? 'On the client portal'}</p>
      <div className="flex flex-wrap gap-2">
        {portalToken && (
          <Button variant="outline" className={outlineBtn}
            onClick={() => {
              void portalLinkFor().then(link => navigator.clipboard.writeText(link))
                .then(() => setCopied(forWho ? 'Their portal link copied — send it to them' : 'Portal link copied — send it to the client'))
                .catch(() => setCopied('Could not copy — copy it from the Clients page'))
            }}>
            <LinkIcon className="h-4 w-4" aria-hidden /> Copy portal link
          </Button>
        )}
        {/* JUST THE BOARD (13 Sep 2026): the canvas on its own page, same
            token, the client's comments land on this shoot. The board is
            switched on if an older page turned it off. */}
        {portalToken && (
          <Button variant="outline" className={outlineBtn}
            onClick={() => {
              const boardOff = (batch as { share_board?: boolean | null }).share_board === false
              const turnOn = boardOff ? onPatch('share_board', true) : Promise.resolve(true)
              void turnOn.then(ok => ok ? portalLinkFor() : Promise.reject(new Error('not shared')))
                .then(link => navigator.clipboard.writeText(`${link}/board/${batch.id}`))
                .then(() => setCopied('Board link copied — send it to the client'))
                .catch(() => setCopied('Could not copy the board link'))
            }}>
            <LinkIcon className="h-4 w-4" aria-hidden /> Copy board link
          </Button>
        )}
        {pdf}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {copied ?? 'They approve on their portal or ask for changes, and the answer shows here. No email is sent.'}
        {' '}
        <button type="button" className="underline underline-offset-4" disabled={busy} onClick={() => void onPatch('shared_with_client', false)}>Take it off the portal</button>
      </p>
    </div>
  )
}
