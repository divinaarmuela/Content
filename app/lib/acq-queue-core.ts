/**
 * MY QUEUE — the pure half (the acquisition blueprint, §10 "Task &
 * Notification view": what waits on me, across every prospect, in one list).
 *
 * Three kinds of thing wait on a person:
 *   task     — a follow-up reminder or a hand-off task on their To-dos, tied
 *              to a prospect (Day 1 · Day 3 · … after outreach, "Make the
 *              audit", "Reach out")
 *   finding  — something the agent read in the inbox or the DMs and was not
 *              sure enough to record: a Confirm or a Dismiss is owed
 *   clock    — a prospect they own that has sat in its stage past the
 *              blueprint's limit
 * Soonest first. A manager may look at everyone's; anyone else sees their
 * own. No I/O.
 */

import { acqDaysOver, acqLimitWords, acqStageByKey, ACQ_EVENT_KINDS, type Prospect } from './acquisition-core'
import { isOpenFinding } from './acq-agent-core'

export type QueueViewer = { id: string; role: string } | null | undefined

type ProspectLike = Pick<Prospect, 'id' | 'business' | 'stage' | 'stage_entered_at' | 'created_at' | 'not_now_at' | 'dormant_at' | 'owner_id'>
type TodoLike = { id: string; prospect_id?: string | null; title: string; note?: string | null; status: string; due_date?: string | null; owner_id?: string | null; created_at: string }
type EventLike = { id: string; prospect_id: string; kind: string; at: string; detail?: string | null; confirmed?: boolean | null; dismissed_at?: string | null; source?: string | null; confidence?: number | null }

export type QueueItem = {
  key: string
  kind: 'task' | 'finding' | 'clock'
  prospect_id: string
  business: string
  title: string
  words: string
  /** when it is due or happened, ISO — the sort key */
  when: string | null
  todo_id?: string
  event_id?: string
}

export type QueueGroup = { key: QueueItem['kind']; label: string; empty: string; items: QueueItem[] }

export const QUEUE_LABELS: Record<QueueItem['kind'], { label: string; empty: string }> = {
  task: { label: 'To do', empty: 'No follow-ups or tasks waiting on you.' },
  finding: { label: 'Confirm or dismiss', empty: 'The agent has nothing it is unsure about.' },
  clock: { label: 'Over the clock', empty: 'Nothing has sat in its stage too long.' },
}

/** a manager may look at everyone's queue; anyone else sees their own */
export function mayViewEveryone(viewer: QueueViewer): boolean {
  return viewer?.role === 'account_manager' || viewer?.role === 'super_admin'
}

export function queueFor(input: {
  viewer: QueueViewer
  prospects: readonly ProspectLike[]
  todos: readonly TodoLike[]
  events: readonly EventLike[]
  now: number
  /** a manager looking at everyone's */
  everyone?: boolean
}): QueueGroup[] {
  const me = input.viewer?.id ?? null
  const all = !!input.everyone && mayViewEveryone(input.viewer)
  const byId = new Map(input.prospects.map(p => [p.id, p]))
  const mine = (ownerId: string | null | undefined) => all || (!!me && ownerId === me)

  const tasks: QueueItem[] = input.todos
    .filter(t => t.status === 'open' && !!t.prospect_id && byId.has(String(t.prospect_id)) && mine(t.owner_id))
    .map(t => {
      const p = byId.get(String(t.prospect_id))!
      return { key: `task:${t.id}`, kind: 'task' as const, prospect_id: p.id, business: p.business, title: t.title, words: String(t.note ?? '').trim(), when: t.due_date ?? t.created_at, todo_id: t.id }
    })

  const findings: QueueItem[] = input.events
    .filter(e => isOpenFinding(e) && byId.has(e.prospect_id) && mine(byId.get(e.prospect_id)!.owner_id))
    .map(e => {
      const p = byId.get(e.prospect_id)!
      const label = ACQ_EVENT_KINDS[e.kind as keyof typeof ACQ_EVENT_KINDS]?.label ?? e.kind
      const sure = typeof e.confidence === 'number' ? ` · ${Math.round(e.confidence * 100)}% sure` : ''
      return { key: `finding:${e.id}`, kind: 'finding' as const, prospect_id: p.id, business: p.business, title: `${label}?${sure}`, words: String(e.detail ?? '').trim(), when: e.at, event_id: e.id }
    })

  const clock: QueueItem[] = input.prospects
    .filter(p => mine(p.owner_id) && (acqDaysOver(p, input.now) ?? 0) > 0)
    .map(p => ({ key: `clock:${p.id}`, kind: 'clock' as const, prospect_id: p.id, business: p.business, title: `${acqStageByKey(p.stage).label} · ${acqLimitWords(p, input.now) ?? ''}`.trim(), words: 'Move it on, park it as Not now, or let it go dormant.', when: p.stage_entered_at ?? p.created_at ?? null }))

  const soonest = (a: QueueItem, b: QueueItem) => String(a.when ?? '9').localeCompare(String(b.when ?? '9'))
  return (['task', 'finding', 'clock'] as const).map(kind => ({
    key: kind, ...QUEUE_LABELS[kind],
    items: (kind === 'task' ? tasks : kind === 'finding' ? findings : clock).sort(soonest),
  }))
}

/** the count on the tab: everything waiting, all three kinds */
export function queueCount(groups: readonly QueueGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0)
}

/** "Due Tue 23 Sept" / "Overdue since Mon 21 Sept" — the task's due line */
export function dueWords(iso: string | null | undefined, nowMs: number, fmt: (iso: string) => string): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return t < nowMs - 86_400_000 ? `Overdue since ${fmt(iso)}` : `Due ${fmt(iso)}`
}
