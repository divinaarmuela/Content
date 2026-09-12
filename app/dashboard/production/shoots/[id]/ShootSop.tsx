'use client'

import { useState } from 'react'
import { Check, Circle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  BRIEF_ITEMS, SHOOT_STAGES, STAGE_LABEL, STAGE_STRIP, ackState, briefChecklist, briefIsLate, briefItemFilled, briefItemSource,
  clockWords, goReady, handoverReady, hasAcknowledged, nextStepWords, overrideWords, peopleOnShoot, shootStage, stageIndex, stageMove,
  type BriefItemKey, type MoveRole, type ShootStage, type SopShoot,
} from '../../../../lib/shoot-sop-core'
import Chip from '../../../ui/Chip'

/**
 * THE SHOOT BRIEF SOP ON THE SHOOT PAGE — three panels.
 *
 *   BriefParts   the nine things a brief must contain, each with its field
 *                and a tick, and "6 of 9 filled" at the top
 *   TeamPanel    who is on the shoot (the AM picks the editor and the crew),
 *                who has read the brief, and the one button a crew member
 *                presses: "I've read the brief"
 *   GoPanel      where the shoot is on the timeline, the clock, the AM's
 *                two ticks, and the one next move — Share, Confirm as go,
 *                Reminder sent, Footage handed over
 *
 * Every rule is read from shoot-sop-core, so the page can never offer a
 * button the route would refuse; the reasons it is not yet "go" are listed
 * in plain words instead.
 */

export type ShootSopBatch = SopShoot & {
  title: string
  status?: string | null
  shot_list?: unknown
}
export type CrewRow = { id: string; name: string; role: string | null; acknowledged_at: string | null }
export type TeamRow = { id: string; name: string; role: string }

const isManager = (r: MoveRole) => r === 'account_manager' || r === 'super_admin'
/** who staffs a shoot: managers, and a general user who raised it */
const picksTeam = (r: MoveRole) => isManager(r) || r === 'general'

/* ── the flow, on the page ─────────────────────────────────────────────── */

/**
 * THE SIX STAGES ACROSS THE TOP, and one line under them saying what
 * happens next and who does it (the owner, 11 Sep 2026: "you need to
 * explain to be in the shoot creation page"). The words come from
 * `nextStepWords`, the same rules the buttons obey.
 */
export function StageStrip({ batch, today, role, itemCount }: {
  batch: SopShoot
  today: string
  role: MoveRole
  itemCount: number
}) {
  const stage = shootStage(batch, today)
  const at = stageIndex(stage)
  const line = nextStepWords(batch, today, { itemCount, role })
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-3">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5" aria-label="Where this shoot is">
        {STAGE_STRIP.map((s, i) => {
          const done = i < at
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
                <span className="sr-only">{now ? ' — now' : done ? ' — done' : ' — to come'}</span>
              </span>
              {i < STAGE_STRIP.length - 1 && <span aria-hidden className="text-muted-foreground">›</span>}
            </li>
          )
        })}
      </ol>
      <p className="text-[14px]" role="status">{line}</p>
    </div>
  )
}

/* ── the nine parts ────────────────────────────────────────────────────── */

export function BriefParts({ batch, canEdit, itemCount, onPatch }: {
  batch: ShootSopBatch
  canEdit: boolean
  itemCount: number
  onPatch: (field: string, value: unknown) => Promise<boolean>
}) {
  const list = briefChecklist(batch, { itemCount })
  const save = (field: keyof ShootSopBatch) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.target.value.trim()
    if (v !== String(batch[field] ?? '').trim()) void onPatch(field, v || null)
  }
  const tick = (key: BriefItemKey) => briefItemFilled(batch, key, { itemCount })
  const Tick = ({ on }: { on: boolean }) => on
    ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-green text-ink" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
    : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground" aria-hidden><Circle className="h-3 w-3" /></span>

  const row = (key: BriefItemKey, field: React.ReactNode) => {
    const item = BRIEF_ITEMS.find(i => i.key === key)!
    const on = tick(key)
    // the plan built on the canvas counts, and the row says so
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
    <Textarea key={String(batch[field] ?? '')} defaultValue={String(batch[field] ?? '')} disabled={!canEdit} rows={rows}
      placeholder={placeholder} aria-label={placeholder} className="min-h-11 text-[15px]" onBlur={save(field)} />
  )
  const line = (field: keyof ShootSopBatch, placeholder: string) => (
    <Input key={String(batch[field] ?? '')} defaultValue={String(batch[field] ?? '')} disabled={!canEdit}
      placeholder={placeholder} aria-label={placeholder} className="h-11 text-[15px]" onBlur={save(field)} />
  )

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">The shoot plan — nine parts</p>
          <Chip tone={list.complete ? 'green' : 'amber'} className="ml-auto"><span role="status">{list.words}</span></Chip>
        </div>
        <p className="-mt-2 text-[13px] text-muted-foreground">
          The playbook: a plan is not complete until every part is filled in, and it is shared 7 days before the shoot. Nothing moves forward on half-information.
        </p>
        {row('objective', area('objective', 'What this shoot is meant to achieve, and which pillar or campaign it serves'))}
        {row('deliverables', (
          <p className="text-[13px] text-muted-foreground">
            {Array.isArray(batch.planned_deliverables) && batch.planned_deliverables.length > 0
              ? `${batch.planned_deliverables.length} line${batch.planned_deliverables.length === 1 ? '' : 's'} in “What is coming out of this shoot”`
              : itemCount > 0 ? `${itemCount} card${itemCount === 1 ? '' : 's'} pointed at this shoot`
              : 'Add the outputs under “What is coming out of this shoot” — on the right, or below on a phone. The editor gets one card for the whole shoot.'}
          </p>
        ))}
        {row('shot_list', (
          <p className="text-[13px] text-muted-foreground">
            {Array.isArray(batch.shot_list) && batch.shot_list.length > 0
              ? `${batch.shot_list.length} shot${batch.shot_list.length === 1 ? '' : 's'} listed below`
              : 'List the shots below, scene by scene.'}
          </p>
        ))}
        {row('script', area('script', 'The script or the talking points, finalised and approved', 3))}
        {row('when_where', (
          <div className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Call time
              <Input key={batch.call_time ?? ''} defaultValue={batch.call_time ?? ''} disabled={!canEdit}
                placeholder="7:30 am" className="h-11 max-w-[200px] text-[15px] font-normal" onBlur={save('call_time')} />
            </label>
            <p className="text-[13px] text-muted-foreground">
              {batch.shoot_date ? 'Date set' : 'No date yet'} · {batch.location ? 'location set' : 'no location yet'} — both are under Shoot details.
            </p>
          </div>
        ))}
        {row('talent', line('talent', 'Who is on camera, confirmed and briefed'))}
        {row('props', area('props_wardrobe', 'What is needed and who is bringing it'))}
        {row('client_availability', line('client_availability', 'When the client or their team is on the day'))}
        {row('editor', (
          <div className="flex flex-col gap-1.5">
            {area('editor_priorities', 'What to cut first, and what the video is meant to achieve')}
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Editor deadline
              <Input type="date" key={batch.edit_deadline ?? ''} defaultValue={batch.edit_deadline ?? ''} disabled={!canEdit}
                className="h-11 max-w-[200px] font-mono text-[14px] font-normal" onBlur={save('edit_deadline')} />
            </label>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/* ── who is on the shoot ───────────────────────────────────────────────── */

export function TeamPanel({ batch, crew, team, viewerId, role, busy, onPatch, onAck, onUnack }: {
  batch: ShootSopBatch
  crew: CrewRow[]
  team: TeamRow[]
  viewerId: string
  role: MoveRole
  busy: boolean
  onPatch: (field: string, value: unknown) => Promise<boolean>
  onAck: () => Promise<void>
  onUnack: (userId: string) => Promise<void>
}) {
  const manager = isManager(role)
  const picks = picksTeam(role)
  const ack = ackState(batch)
  const onShoot = peopleOnShoot(batch).includes(viewerId)
  const mine = hasAcknowledged(batch, viewerId)
  const editors = team.filter(t => t.role === 'editor')
  const crewIds = Array.isArray(batch.crew_ids) ? batch.crew_ids.map(String) : []
  const addable = team.filter(t => !crewIds.includes(t.id) && t.id !== batch.editor_id)
  const [adding, setAdding] = useState('')

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Who is on this shoot</p>
          {ack.total > 0 && <Chip tone={ack.complete ? 'green' : 'amber'} className="ml-auto"><span role="status">{ack.words}</span></Chip>}
        </div>

        {onShoot && (
          mine
            ? <p className="flex items-center gap-2 rounded-inner bg-tint-green px-3 py-2.5 text-[14px] font-semibold"><Check className="h-4 w-4" aria-hidden /> You have read this plan</p>
            : (
              <Button className="h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90"
                disabled={busy} onClick={() => void onAck()}>
                I’ve read the plan
              </Button>
            )
        )}

        {picks ? (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Editor: who edits the footage after the shoot
            <Select value={batch.editor_id ?? 'none'} onValueChange={v => void onPatch('editor_id', v === 'none' ? null : v)}>
              <SelectTrigger className="h-11 text-[15px] font-normal" aria-label="Editor"><SelectValue placeholder="Pick the editor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not picked yet</SelectItem>
                {editors.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        ) : (
          <p className="text-[14px]"><span className="text-muted-foreground">Editor:</span> {crew.find(c => c.id === batch.editor_id)?.name ?? 'not picked yet'}</p>
        )}

        <ul className="flex flex-col gap-1.5" aria-label="People on the shoot">
          {crew.length === 0 && <li className="text-[13px] text-muted-foreground">Nobody on the day yet. {picks ? 'Add the videographer, the presenter and anyone else on set.' : 'The account manager adds the crew.'}</li>}
          {crew.map(c => (
            <li key={c.id} className="flex min-h-11 items-center gap-2 text-[14px]">
              {c.acknowledged_at
                ? <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-green text-ink" aria-hidden><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
                : <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {c.name}{c.id === batch.editor_id && <span className="text-muted-foreground"> · editor</span>}
                <span className="sr-only">{c.acknowledged_at ? ', has read the plan' : ', has not read the plan yet'}</span>
              </span>
              <span className="text-[12px] text-muted-foreground">{c.acknowledged_at ? 'read it' : 'not yet'}</span>
              {manager && c.acknowledged_at && (
                <button type="button" onClick={() => void onUnack(c.id)} disabled={busy}
                  className="min-h-11 rounded-full px-2 text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                  Undo
                </button>
              )}
              {picks && c.id !== batch.editor_id && (
                <button type="button" aria-label={`Take ${c.name} off the shoot`} disabled={busy}
                  onClick={() => void onPatch('crew_ids', crewIds.filter(id => id !== c.id))}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-accent-red-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-blue">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>

        {picks && addable.length === 0 && (
          <p className="text-[13px] text-muted-foreground">Everyone on the team is already on this shoot. New people are added on the Team page.</p>
        )}
        {picks && addable.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-semibold">
              Crew on the day: videographer, presenter, anyone on set
              <Select value={adding} onValueChange={v => setAdding(v ?? '')}>
                <SelectTrigger className="h-11 text-[15px] font-normal" aria-label="Crew on the day"><SelectValue placeholder="Pick a person" /></SelectTrigger>
                <SelectContent>
                  {addable.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <Button variant="outline" className="h-11 rounded-full px-4 text-[14px] font-semibold" disabled={!adding || busy}
              onClick={async () => { const ok = await onPatch('crew_ids', [...crewIds, adding]); if (ok) setAdding('') }}>
              Add
            </Button>
          </div>
        )}
        <p className="text-[12px] text-muted-foreground">Each person here is emailed the plan when it is shared, and must press “I’ve read the plan” before the shoot can be confirmed.</p>
      </CardContent>
    </Card>
  )
}

/* ── where it is, and the next move ───────────────────────────────────── */

export function GoPanel({ batch, role, viewerId, today, itemCount, busy, names, onPatch, onMove }: {
  batch: ShootSopBatch
  role: MoveRole
  viewerId: string
  today: string
  itemCount: number
  busy: boolean
  names: { go_by?: string | null; shared_by?: string | null; handed_by?: string | null }
  onPatch: (field: string, value: unknown) => Promise<boolean>
  onMove: (to: ShootStage, opts?: { reason?: string }) => Promise<void>
}) {
  const manager = isManager(role)
  const stage = shootStage(batch, today)
  const late = briefIsLate(batch, today)
  const clock = clockWords(batch, today)
  // NO BRIEF, NO SHOOT: a plan shared late cannot be confirmed by an AM; a
  // super admin says why and goes ahead — the reason is kept on the shoot
  const [reason, setReason] = useState('')
  const go = goReady(batch, { itemCount, role, overrideReason: reason })
  const can = (to: ShootStage) => stageMove(batch, to, { role, today, checklist: { itemCount }, overrideReason: reason }, 'now', viewerId)
  const askOverride = stage === 'shared' && role === 'super_admin' && goReady(batch, { itemCount }).needsOverride
  const wentLate = overrideWords(batch)
  // WHERE THE FOOTAGE LIVES: whoever has it pastes the folder — the crew
  // included, whatever their role (the owner, 11 Sep 2026: "how do they get
  // the dropbox link"). It reaches every card as "Files to work from" when
  // the footage is handed over, and the editor's email carries it.
  const mayPasteFolder = isManager(role) || role === 'editor' || role === 'general' || peopleOnShoot(batch).includes(viewerId)
  const [folder, setFolder] = useState(batch.footage_url ?? '')
  const folderShown = stage !== 'drafting'
  const next: { to: ShootStage; label: string; primary: boolean }[] = [
    { to: 'shared', label: 'Share the plan with the team', primary: true },
    { to: 'confirmed', label: 'Confirm — it is go', primary: true },
    { to: 'reminder_sent', label: 'Reminder sent to everyone', primary: false },
    { to: 'footage_handed', label: 'Footage is in', primary: true },
  ]
  const shown = next.filter(n => {
    if (n.to === 'shared') return stage === 'drafting'
    if (n.to === 'confirmed') return stage === 'shared' && manager
    if (n.to === 'reminder_sent') return stage === 'confirmed'
    if (n.to === 'footage_handed') return stage === 'shoot_day' || (stage !== 'footage_handed' && (can('footage_handed').ok))
    return false
  })
  const meaning = SHOOT_STAGES.find(s => s.key === stage)?.meaning

  return (
    <Card className={late ? 'border-accent-red/40 bg-tint-red' : undefined}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[12px] uppercase tracking-widest text-muted-foreground">Where it is</p>
          <Chip tone={stage === 'footage_handed' ? 'green' : stage === 'shoot_day' ? 'amber' : 'ink'} className="ml-auto">{STAGE_LABEL[stage]}</Chip>
        </div>
        {clock && (
          <p className={`text-[15px] font-semibold ${late ? 'text-accent-red-deep' : ''}`} role={late ? 'alert' : undefined}>{clock}</p>
        )}
        {meaning && <p className="text-[13px] text-muted-foreground">{meaning}</p>}
        {names.shared_by && batch.brief_shared_at && <p className="text-[12px] text-muted-foreground">Shared by {names.shared_by}</p>}
        {names.go_by && batch.go_at && <p className="text-[12px] text-muted-foreground">Confirmed as go by {names.go_by}</p>}
        {wentLate && <Chip tone="amber" className="w-fit">{wentLate}</Chip>}
        {names.handed_by && batch.footage_handed_at && <p className="text-[12px] text-muted-foreground">Footage marked in by {names.handed_by}</p>}

        {manager && stage !== 'footage_handed' && (
          <div className="flex flex-col gap-1.5">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--dbx-blue)]" checked={!!batch.aligned_at} disabled={busy}
                onChange={e => void onPatch('aligned', e.target.checked)} />
              Aligned with the strategist or creative director
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--dbx-blue)]" checked={!!batch.client_confirmed_at} disabled={busy}
                onChange={e => void onPatch('client_confirmed', e.target.checked)} />
              Client availability and location confirmed
            </label>
          </div>
        )}

        {stage === 'shared' && !go.ok && (
          <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground" aria-label="Before it can be go">
            {go.reasons.map(r => <li key={r} className="flex gap-2"><span aria-hidden>·</span>{r}</li>)}
          </ul>
        )}
        {askOverride && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Why is it going ahead late? Ops is told, with your reason.
            <Input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
              placeholder="One line — the client moved the date, the crew is already booked…"
              className="h-11 text-[15px] font-normal" aria-label="Reason for going ahead late" />
          </label>
        )}

        {folderShown && (
          <label className="flex flex-col gap-1 text-[12px] font-semibold">
            Footage folder <span className="font-normal text-muted-foreground">(Dropbox or Drive — whoever has the footage pastes it; the editor gets it on their card)</span>
            {mayPasteFolder ? (
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
            ) : (
              <span className="text-[14px] font-normal">
                {batch.footage_url
                  ? <a href={batch.footage_url} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">Open the footage folder</a>
                  : 'Not pasted yet.'}
              </span>
            )}
          </label>
        )}

        {shown.map(n => {
          const check = can(n.to)
          const overriding = n.to === 'confirmed' && askOverride
          return (
            <div key={n.to} className="flex flex-col gap-1">
              <Button
                className={n.primary
                  ? 'h-11 rounded-full bg-foreground px-5 text-[14px] font-semibold text-background hover:bg-foreground/90'
                  : 'h-11 rounded-full px-5 text-[14px] font-semibold'}
                variant={n.primary ? 'default' : 'outline'}
                disabled={busy || !check.ok}
                onClick={() => void onMove(n.to, overriding ? { reason: reason.trim() } : undefined)}>
                {overriding ? 'Go anyway (super admin)' : n.label}
              </Button>
              {!check.ok && <p className="text-[12px] text-muted-foreground">{check.reason}</p>}
            </div>
          )
        })}
        {(stage === 'confirmed' || stage === 'reminder_sent' || stage === 'shoot_day') && (
          <p className="text-[13px] text-muted-foreground">
            {handoverReady(batch)
              ? 'The editor’s card is on the Editor page already; the footage follows the shoot. The morning after the shoot it is handed over by itself — press “Footage is in” only if it is in early.'
              : 'Name the editor, the priorities and the deadline so the card can be theirs — the handover waits on those three.'}
          </p>
        )}
        {stage === 'footage_handed' && (
          <p className="text-[13px]">Footage should be in — the editor has been told. The work is on the Editor page{batch.edit_deadline ? `, due ${batch.edit_deadline}` : ''}.</p>
        )}
      </CardContent>
    </Card>
  )
}
