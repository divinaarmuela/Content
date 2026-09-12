'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, ChevronDown, Clapperboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SHOOT_STAGES, ackState, briefChecklist, briefIsLate, clockWords, overrideWords, shootStage, stageMove,
  type MoveRole, type ShootStage, type SopShoot,
} from '../../lib/shoot-sop-core'
import { LaneBoard, type Lane } from './LaneBoard'
import { BRIEF_KIND_LABELS } from '../../lib/brief-task-core'
import type { ItemStatus } from '../../lib/workflow-core'
import WorkCard, { type Person, type WorkTone } from '../ui/WorkCard'
import Chip from '../ui/Chip'

/**
 * THE SHOOT BRIEF BOARDS PAGE, AS THE PLAYBOOK'S TIMELINE.
 *
 * Six columns in the SOP's own order — Drafting, Shared with team,
 * Confirmed, Reminder sent, Shoot day, Footage handed over — and one card
 * per shoot, in the column its stamps and the calendar put it in
 * (`shootStage`). Dragging a card asks for the next stamp; the lanes the
 * SOP allows light up while you hold it, and a refusal comes back in the
 * SOP's words. The same moves sit under "Move…" on the card, so a phone or
 * a keyboard gets them too — a drag-only board is no board for half the
 * team.
 *
 * Presentation only: every rule is in shoot-sop-core, the write is the
 * stage route.
 */

export type StageShoot = SopShoot & {
  title: string
  status?: string | null
  clients?: { name?: string | null } | null
}

const TONE: Partial<Record<ShootStage, WorkTone>> = {
  shoot_day: 'amber',
  footage_handed: 'green',
}

/** the plan's approval, as a colour: with the client is blue, approved is
 *  green, sent back is amber, and being written is quiet */
function planTone(status: ItemStatus): 'blue' | 'green' | 'amber' | 'muted' {
  if (status === 'client_review') return 'blue'
  if (status === 'approved_for_scheduling' || status === 'scheduled' || status === 'published') return 'green'
  if (status === 'revision_required' || status === 'client_changes_requested') return 'amber'
  return 'muted'
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '') || name.slice(0, 2)).toUpperCase()
}

function whenShort(iso: string | null | undefined) {
  return iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null
}

export function ShootStageBoard({
  shoots, itemCounts, plans, names, role, viewerId, today, onMove, busyId, laneEmpty,
}: {
  shoots: StageShoot[]
  /** an empty column's sentence while the page is narrowed to a client or a
   *  person — "No cards for Ada in Shared with team" */
  laneEmpty?: (laneLabel: string) => string | null
  /** cards already pointed at each shoot — a deliverable is a line OR a card */
  itemCounts: Map<string, number>
  /** where each shoot's PLAN DOCUMENT is in its own approval (being written,
   *  with the client, approved) — the one line that used to need the old
   *  work board to read; the moves are on the shoot page */
  plans?: Map<string, ItemStatus>
  names: Map<string, string>
  role: MoveRole
  viewerId: string
  today: string
  onMove: (shoot: StageShoot, to: ShootStage) => Promise<void>
  busyId: string | null
}) {
  const router = useRouter()
  const [dragging, setDragging] = useState<StageShoot | null>(null)
  const [over, setOver] = useState<ShootStage | null>(null)
  // a drop is a click too; the card must not open on the way down
  const justDragged = useRef(false)

  const checklist = (s: StageShoot) => ({ itemCount: itemCounts.get(s.id) ?? 0 })
  const allowed = (s: StageShoot, to: ShootStage) =>
    stageMove(s, to, { role, today, checklist: checklist(s) }, 'now', viewerId).ok

  const grouped = useMemo(() => {
    const by = new Map<ShootStage, StageShoot[]>(SHOOT_STAGES.map(st => [st.key, []]))
    for (const s of shoots) by.get(shootStage(s, today))!.push(s)
    // nearest shoot first inside a column
    for (const list of by.values()) list.sort((a, b) => String(a.shoot_date ?? '9').localeCompare(String(b.shoot_date ?? '9')))
    return by
  }, [shoots, today])

  const reachable = useMemo(() => {
    if (!dragging) return new Set<ShootStage>()
    return new Set(SHOOT_STAGES.map(st => st.key).filter(k => allowed(dragging, k)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging, role, today, itemCounts])

  const drop = (to: ShootStage) => {
    const s = dragging
    setDragging(null); setOver(null)
    if (!s) return
    void onMove(s, to)
  }

  const open = (s: StageShoot) => {
    if (justDragged.current) return
    router.push(`/dashboard/production/shoots/${s.id}`)
  }

  const card = (s: StageShoot) => {
    const stage = shootStage(s, today)
    const late = briefIsLate(s, today)
    const list = briefChecklist(s, checklist(s))
    const ack = ackState(s)
    const clock = clockWords(s, today)
    const editorName = s.editor_id ? names.get(s.editor_id) : undefined
    const people: Person[] = editorName ? [{ id: s.editor_id!, name: editorName, initials: initialsOf(editorName) }] : []
    const moves = SHOOT_STAGES.filter(st => st.key !== stage && allowed(s, st.key))
    const note = stage === 'drafting' && !list.complete
      ? `Still to fill in: ${list.missing.map(m => m.label.toLowerCase()).join(', ')}`
      : stage === 'shared' && !ack.complete && ack.total > 0
      ? `Waiting on: ${ack.missing.map(id => names.get(id) ?? 'someone').join(', ')}`
      : (stage === 'confirmed' || stage === 'reminder_sent') && editorName
      ? `${editorName} has the card — footage after the shoot${s.edit_deadline ? ` · due ${whenShort(s.edit_deadline)}` : ''}`
      : stage === 'shoot_day' && editorName
      ? `Footage goes to ${editorName} the morning after`
      : stage === 'footage_handed' && editorName
      ? `With ${editorName}${s.edit_deadline ? ` · due ${whenShort(s.edit_deadline)}` : ''}`
      : null
    return (
      <div
        key={s.id}
        role="listitem"
        draggable={busyId === null}
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', s.id)
          justDragged.current = true
          setDragging(s)
        }}
        onDragEnd={() => {
          setDragging(null); setOver(null)
          setTimeout(() => { justDragged.current = false }, 0)
        }}
        className={dragging?.id === s.id ? 'opacity-50' : ''}
      >
        <WorkCard
          onOpen={() => open(s)}
          client={s.clients?.name ?? '—'}
          title={s.title}
          tone={late ? 'red' : TONE[stage]}
          people={people}
          chips={<>
            {clock && <Chip tone={late ? 'red' : stage === 'shoot_day' ? 'amber' : 'muted'} className="h-auto whitespace-normal text-left">{clock}</Chip>}
            {(stage === 'drafting' || stage === 'shared') && (
              <Chip tone={list.complete ? 'green' : 'surface'}>{list.words}</Chip>
            )}
            {(stage === 'shared' || stage === 'confirmed') && ack.total > 0 && (
              <Chip tone={ack.complete ? 'green' : 'amber'}>{ack.words}</Chip>
            )}
            {s.shoot_date && <Chip><CalendarDays className="h-3.5 w-3.5" aria-hidden />{whenShort(s.shoot_date)}</Chip>}
            {overrideWords(s) && <Chip tone="amber">{overrideWords(s)}</Chip>}
            {plans?.get(s.id) && (
              <Chip tone={planTone(plans.get(s.id)!)}>{BRIEF_KIND_LABELS[plans.get(s.id)!]}</Chip>
            )}
          </>}
          note={note}
          actions={moves.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={busyId === s.id}
                  className="h-11 rounded-full border-border bg-surface px-4 text-[14px] font-semibold">
                  Move… <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {moves.map(st => (
                  <DropdownMenuItem key={st.key} className="min-h-11" onClick={() => void onMove(s, st.key)}>
                    {st.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : <></>}
        />
      </div>
    )
  }

  const lanes: Lane[] = SHOOT_STAGES.map(st => {
    const inLane = grouped.get(st.key) ?? []
    const active = dragging !== null && reachable.has(st.key)
    return {
      key: st.key,
      title: st.label,
      count: inLane.length,
      empty: laneEmpty?.(st.label) ?? st.empty,
      cards: inLane.map(card),
      hint: <span className="sr-only">{st.meaning}</span>,
      drop: {
        active, over: over === st.key,
        label: `${st.label} — drop a shoot here to move it`,
        onDragOver: (e: React.DragEvent) => { if (dragging) { e.preventDefault(); if (over !== st.key) setOver(st.key) } },
        onDragLeave: () => { if (over === st.key) setOver(null) },
        onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(st.key) },
        dimmed: dragging !== null && !active,
      },
    }
  })

  if (shoots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-tile bg-foreground/[0.06]">
          <Clapperboard className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        <p className="text-[17px] font-semibold">No shoots yet</p>
        <p className="max-w-sm text-[15px] text-muted-foreground">
          A shoot starts as a plan. Press New shoot plan.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <LaneBoard ariaLabel="Shoots, by stage of the plan" lanes={lanes} />
      <p className="text-[13px] text-muted-foreground">
        Drag a shoot to the next column, or press Move… on the card. The board only allows what the playbook allows, and says why when it does not.
      </p>
    </div>
  )
}
