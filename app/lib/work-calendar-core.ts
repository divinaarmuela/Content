/**
 * The calendar behind Production, Editor and Scheduler — pure, no I/O.
 *
 * A board answers "whose step is this waiting on". It cannot answer "what is
 * happening on Thursday", and that is the question people actually open the
 * week with. The three work pages now each carry a calendar, and all three are
 * drawn from this one module so a date can never mean two different things on
 * two pages.
 *
 * THE ONE RULE WORTH STATING. There are two kinds of date in this product and
 * they are filed differently:
 *
 *   • A POSTING TIME is an instant. Which day it falls on is a fact about the
 *     AUDIENCE, so it is bucketed in the CLIENT's zone (timezone-core's
 *     `dayKeyInZone`). A 9 am Melbourne post is Thursday for the client and
 *     Wednesday night for a scheduler in Manila; the calendar says Thursday,
 *     because that is what the client's own portal says.
 *   • A DUE DATE or a SHOOT DATE is a plain calendar date — 'YYYY-MM-DD' in
 *     the database, with no instant behind it. Handing it to `new Date()` and
 *     reading the day back is how a due date one time zone west of UTC starts
 *     landing on the day before. It is never parsed; the ten characters ARE
 *     the day key.
 *
 * The month grid is built in UTC arithmetic for the same reason: a grid is a
 * wall calendar, and adding 24 hours to a local Date crosses a DST boundary
 * twice a year and produces the same day twice.
 */

import type { BatchStatus } from './batch-brief-core'
import { BATCH_STATUS_LABEL } from './batch-brief-core'
import { itemStatusLabel } from './brief-task-core'
import { taskStatusLabel } from './task-kind-core'
import { DEFAULT_TZ, dayKeyInZone, safeZone } from './timezone-core'
import { STATUS_LABELS, type ItemStatus } from './workflow-core'
import { isBriefTask, isInternalTask, isManager, type Viewer } from './work-pages-core'

/* ── what a page hands in ───────────────────────────────────────────────── */

/** A content item as `/api/production/items` returns it, calendar-shaped. */
export type CalItem = {
  id: string
  title: string
  status: ItemStatus
  due_date: string | null
  owner_id: string | null
  client_id?: string | null
  content_type?: string | null
  current_version_number?: number
  clients?: { name?: string | null; timezone?: string | null } | null
  work_kinds?: { name?: string; slug?: string; color?: string; uses_media?: boolean } | null
}

/** A shoot as `/api/production/batches` returns it. */
export type CalBatch = {
  id: string
  title: string
  status: BatchStatus | null
  shoot_date: string | null
  owner_id?: string | null
  client_id?: string | null
  clients?: { name?: string | null } | null
}

/** A `schedule_entries` row with its item, as `/api/production/schedule` gives it. */
export type CalEntry = {
  id: string
  item_id: string
  platform: string
  scheduled_at: string | null
  publish_status?: string | null
  live_url?: string | null
  content_items?: {
    id?: string
    title?: string | null
    client_id?: string | null
    clients?: { name?: string | null; timezone?: string | null } | null
  } | null
}

export type CalSource = {
  items?: CalItem[]
  batches?: CalBatch[]
  entries?: CalEntry[]
}

export type CalendarPage = 'production' | 'editor' | 'scheduler'

/* ── what comes out ─────────────────────────────────────────────────────── */

export type CalTone = 'zinc' | 'blue' | 'amber' | 'violet' | 'emerald' | 'sky' | 'cyan' | 'rose'

export type CalEvent = {
  /** unique across the whole calendar — a React key and a drag id */
  uid: string
  /** the row this event is ABOUT: what a PATCH addresses */
  entityId: string
  kind: 'shoot' | 'brief' | 'task' | 'asset' | 'post'
  /** 'main' is what the page is for; 'due' is the subtle second layer the
   *  Scheduler's calendar can switch on over its posting times */
  layer: 'main' | 'due'
  /** 'YYYY-MM-DD', or null when the thing has no date yet */
  day: string | null
  /** the instant, for something that happens at a TIME rather than on a day */
  at: string | null
  title: string
  clientId: string | null
  clientName: string | null
  /** the zone this event's time is read in — always the client's */
  clientTz: string
  /** two or three words naming what KIND of thing this is */
  typeChip: string
  /** the state, in the product's own vocabulary — never a database word */
  statusWord: string
  tone: CalTone
  href: string
  /** which field a drag onto another day would write, or null for immovable */
  moveField: 'due_date' | 'shoot_date' | null
  ownerId: string | null
  /** a locked shoot's date is a commitment; it moves through an audited route */
  locked: boolean
  platform?: string | null
  liveUrl?: string | null
  live?: boolean
}

export type CalendarEvents = {
  /** day key → the events on it, already ordered */
  byDay: Map<string, CalEvent[]>
  /** everything with no date — the tray under the grid */
  undated: CalEvent[]
}

/* ── day keys ───────────────────────────────────────────────────────────── */

const PLAIN_DATE = /^(\d{4}-\d{2}-\d{2})/

/**
 * The day key of a plain calendar date, WITHOUT parsing it as an instant.
 *
 * `due_date` is a Postgres `date`: it has no time and no zone, and the ten
 * characters are already the answer. Round-tripping it through `new Date()`
 * is the bug this function exists to make impossible.
 */
export function plainDayKey(value: string | null | undefined): string | null {
  const m = PLAIN_DATE.exec(String(value ?? '').trim())
  return m ? m[1] : null
}

/** The day key of an INSTANT, in the zone whose calendar it belongs to. */
export function instantDayKey(iso: string | null | undefined, tz: string): string | null {
  return dayKeyInZone(iso ?? null, tz)
}

/* ── colour ─────────────────────────────────────────────────────────────── */

const ITEM_TONE: Record<ItemStatus, CalTone> = {
  draft_uploaded: 'zinc',
  internal_review: 'blue',
  revision_required: 'amber',
  revision_complete: 'amber',
  client_review: 'violet',
  client_changes_requested: 'violet',
  approved_for_scheduling: 'emerald',
  scheduled: 'cyan',
  published: 'emerald',
}

/** A shoot's four stages, as colour. The same four the shoots page uses. */
const BATCH_TONE: Record<BatchStatus, CalTone> = {
  brief: 'amber', locked: 'sky', shot: 'violet', wrapped: 'zinc',
}

/** The dot palette a client is identified by, in a fixed order. */
export const CLIENT_TONES: CalTone[] = ['sky', 'violet', 'emerald', 'amber', 'rose', 'cyan', 'blue', 'zinc']

/**
 * A stable colour for a client.
 *
 * A calendar mixes clients in one cell, and the fastest read of "is this one
 * of mine" is a colour, not a name that has been truncated to four letters.
 * Derived from the id so it is the same colour on every page and every
 * machine, with no palette to store and keep in step.
 */
export function clientTone(clientId: string | null | undefined): CalTone {
  const id = String(clientId ?? '')
  if (!id) return 'zinc'
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CLIENT_TONES[h % CLIENT_TONES.length]
}

/* ── words ──────────────────────────────────────────────────────────────── */

/** The state of an item, in the vocabulary its own kind uses. */
export function statusWordFor(i: CalItem): string {
  const fallback = STATUS_LABELS[i.status] ?? STATUS_LABELS.draft_uploaded
  if (isBriefTask(i)) return itemStatusLabel(i.work_kinds?.slug, i.status, fallback)
  if (isInternalTask(i)) {
    return taskStatusLabel(i.work_kinds, i.status, fallback, {
      hasWork: (i.current_version_number ?? 0) > 0,
    })
  }
  return fallback
}

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

function typeChipFor(i: CalItem): string {
  if (isBriefTask(i)) return 'Brief'
  if (isInternalTask(i)) return i.work_kinds?.name || 'Task'
  return titleCase(String(i.content_type ?? 'Asset'))
}

/* ── building events ────────────────────────────────────────────────────── */

function itemEvent(i: CalItem, layer: 'main' | 'due', tz: string): CalEvent {
  const kind = isBriefTask(i) ? 'brief' : isInternalTask(i) ? 'task' : 'asset'
  return {
    uid: `${kind}:${i.id}`,
    entityId: i.id,
    kind,
    layer,
    day: plainDayKey(i.due_date),
    at: null,
    title: i.title,
    clientId: i.client_id ?? null,
    clientName: i.clients?.name ?? null,
    clientTz: safeZone(i.clients?.timezone || tz),
    typeChip: typeChipFor(i),
    statusWord: statusWordFor(i),
    tone: ITEM_TONE[i.status] ?? 'zinc',
    href: `/dashboard/production/${i.id}`,
    moveField: 'due_date',
    ownerId: i.owner_id ?? null,
    locked: false,
  }
}

function shootEvent(b: CalBatch): CalEvent {
  const status: BatchStatus = b.status ?? 'brief'
  return {
    uid: `shoot:${b.id}`,
    entityId: b.id,
    kind: 'shoot',
    layer: 'main',
    day: plainDayKey(b.shoot_date),
    at: null,
    title: b.title,
    clientId: b.client_id ?? null,
    clientName: b.clients?.name ?? null,
    clientTz: DEFAULT_TZ,
    typeChip: 'Shoot',
    statusWord: BATCH_STATUS_LABEL[status],
    tone: BATCH_TONE[status] ?? 'zinc',
    href: `/dashboard/production/shoots/${b.id}`,
    // a date that has been locked is a commitment the whole team has planned
    // around; it moves through "Change date", which demands a reason
    moveField: status === 'brief' ? 'shoot_date' : null,
    ownerId: b.owner_id ?? null,
    locked: status !== 'brief',
  }
}

function postEvent(e: CalEntry, tz: string): CalEvent {
  const clientTz = safeZone(e.content_items?.clients?.timezone || tz)
  const live = e.publish_status === 'published'
  return {
    uid: `post:${e.id}`,
    entityId: e.item_id,
    kind: 'post',
    layer: 'main',
    day: instantDayKey(e.scheduled_at, clientTz),
    at: e.scheduled_at ?? null,
    title: e.content_items?.title || 'Untitled',
    clientId: e.content_items?.client_id ?? null,
    clientName: e.content_items?.clients?.name ?? null,
    clientTz,
    typeChip: e.platform,
    statusWord: live ? STATUS_LABELS.published : STATUS_LABELS.scheduled,
    tone: live ? 'emerald' : 'zinc',
    href: `/dashboard/production/${e.item_id}`,
    // a posting time is set on the item's posting card, where the zone and
    // the platform are chosen together — never by sliding it across a grid
    moveField: null,
    ownerId: null,
    locked: false,
    platform: e.platform,
    liveUrl: e.live_url ?? null,
    live,
  }
}

/* ── ordering ───────────────────────────────────────────────────────────── */

/** Big things first, then the work hanging off them. */
const KIND_RANK: Record<CalEvent['kind'], number> = {
  shoot: 0, brief: 1, post: 2, asset: 3, task: 4,
}

/**
 * The order events sit in inside one day.
 *
 * Anything with a TIME is above anything that merely falls on the day, in
 * time order — a cell that opens with "9:00 am Reel" reads as a schedule,
 * and one that buries it under three undated tasks reads as a pile. Ties are
 * broken all the way down to the id so the order never shuffles between two
 * renders of the same data.
 */
export function orderEvents(events: CalEvent[]): CalEvent[] {
  return [...events].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer === 'main' ? -1 : 1
    if (!!a.at !== !!b.at) return a.at ? -1 : 1
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind]
    const t = a.title.localeCompare(b.title)
    return t !== 0 ? t : a.uid.localeCompare(b.uid)
  })
}

/**
 * Everything a page's calendar draws, bucketed by day.
 *
 * The caller has already applied its scope and its filters — this takes the
 * rows that are meant to be on screen and decides only WHERE they go. `tz` is
 * the fallback zone for a client that has none set (the agency's own).
 */
export function eventsFor(
  page: CalendarPage,
  source: CalSource,
  tz: string = DEFAULT_TZ,
): CalendarEvents {
  const events: CalEvent[] = []

  if (page === 'production') {
    for (const b of source.batches ?? []) events.push(shootEvent(b))
    for (const i of source.items ?? []) {
      // Production carries the plans and the work with nothing to post; the
      // assets are the Editor board's business
      if (isBriefTask(i) || isInternalTask(i)) events.push(itemEvent(i, 'main', tz))
    }
  } else if (page === 'editor') {
    for (const i of source.items ?? []) {
      if (!isBriefTask(i) && !isInternalTask(i)) events.push(itemEvent(i, 'main', tz))
    }
  } else {
    for (const e of source.entries ?? []) events.push(postEvent(e, tz))
    // the second layer: what is DUE, under what POSTS, so one calendar
    // answers both questions
    for (const i of source.items ?? []) events.push(itemEvent(i, 'due', tz))
  }

  const byDay = new Map<string, CalEvent[]>()
  const undated: CalEvent[] = []
  for (const e of events) {
    if (!e.day) { undated.push(e); continue }
    const list = byDay.get(e.day)
    if (list) list.push(e)
    else byDay.set(e.day, [e])
  }
  for (const [k, list] of byDay) byDay.set(k, orderEvents(list))

  return { byDay, undated: orderEvents(undated) }
}

/* ── the grid ───────────────────────────────────────────────────────────── */

export type GridCell = {
  key: string
  day: number
  month: number
  year: number
  /** false for the leading and trailing days borrowed from the months either
   *  side — drawn faint, still real days you can drop onto */
  inMonth: boolean
}

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' from a UTC instant. */
function keyOfUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** A day key back to the UTC midnight it names — the only arithmetic base
 *  that has no DST in it. */
export function keyToUtc(key: string): number {
  const m = PLAIN_DATE.exec(key)
  if (!m) return NaN
  const [y, mo, d] = m[1].split('-').map(Number)
  return Date.UTC(y, mo - 1, d)
}

/** n days from a day key — n may be negative. */
export function shiftDay(key: string, days: number): string {
  const base = keyToUtc(key)
  return Number.isNaN(base) ? key : keyOfUtc(base + days * DAY_MS)
}

/** Monday = 0 … Sunday = 6, for a day key. */
export function weekdayIndex(key: string): number {
  const base = keyToUtc(key)
  return Number.isNaN(base) ? 0 : (new Date(base).getUTCDay() + 6) % 7
}

const cellOf = (ms: number, month: number, year: number): GridCell => {
  const d = new Date(ms)
  return {
    key: keyOfUtc(ms),
    day: d.getUTCDate(),
    month: d.getUTCMonth() + 1,
    year: d.getUTCFullYear(),
    inMonth: d.getUTCMonth() + 1 === month && d.getUTCFullYear() === year,
  }
}

/**
 * The Monday-first weeks that cover a month.
 *
 * Five rows when five will do, six only when the month genuinely needs them:
 * a trailing week made entirely of next month is a row of grey boxes that
 * pushes the real work off the screen.
 */
export function monthGrid(year: number, month: number): GridCell[] {
  const first = Date.UTC(year, month - 1, 1)
  const lead = (new Date(first).getUTCDay() + 6) % 7
  const start = first - lead * DAY_MS
  const cells: GridCell[] = []
  for (let i = 0; i < 42; i++) cells.push(cellOf(start + i * DAY_MS, month, year))
  const lastWeek = cells.slice(35)
  return lastWeek.every(c => !c.inMonth) ? cells.slice(0, 35) : cells
}

/** The Monday-first week containing a day. */
export function weekGrid(dayKey: string, month?: number, year?: number): GridCell[] {
  const base = keyToUtc(dayKey)
  if (Number.isNaN(base)) return []
  const start = base - weekdayIndex(dayKey) * DAY_MS
  const m = month ?? new Date(start).getUTCMonth() + 1
  const y = year ?? new Date(start).getUTCFullYear()
  return Array.from({ length: 7 }, (_, i) => cellOf(start + i * DAY_MS, m, y))
}

/** Step the month cursor, carrying the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const t = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 }
}

/** "Thu 27 Aug" — a day key as a person says it. Formatted in UTC because the
 *  key is a wall date with no instant behind it; anything else re-introduces
 *  the off-by-one-day this module exists to prevent. */
export function dayLabel(key: string): string {
  const ms = keyToUtc(key)
  return Number.isNaN(ms)
    ? key
    : new Date(ms).toLocaleDateString('en-AU', {
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
    }).replace(/,\s*/g, ' ').trim()
}

/** "August 2026" — the heading over the grid. */
export function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' })
}

/** "25 – 31 Aug 2026" — the heading over a week. */
export function weekLabel(cells: GridCell[]): string {
  if (cells.length === 0) return ''
  const fmt = (c: GridCell, withMonth: boolean) => new Date(Date.UTC(c.year, c.month - 1, c.day))
    .toLocaleDateString('en-AU', {
      timeZone: 'UTC', day: 'numeric',
      ...(withMonth ? { month: 'short' as const, year: 'numeric' as const } : {}),
    })
  const a = cells[0]
  const b = cells[cells.length - 1]
  return `${fmt(a, a.month !== b.month)} – ${fmt(b, true)}`
}

/** Today, on the calendar the page is drawn in. Never the browser's day when
 *  that disagrees — the agency's zone is the one the team plans in. */
export function todayKey(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  return dayKeyInZone(now, tz) ?? keyOfUtc(now.getTime())
}

/**
 * Which month to open on, when the current one is empty.
 *
 * Landing on a blank August above a badge reading "1 scheduled" makes the
 * whole calendar look broken. If anything at all falls in the month the
 * viewer is in, stay there — that is where their week is. Otherwise go to the
 * next thing coming up, or, with nothing ahead, the most recent thing behind.
 * Null means "stay put".
 */
export function suggestedDay(days: (string | null | undefined)[], today: string): string | null {
  const keys = days.filter((d): d is string => !!d).sort()
  if (keys.length === 0) return null
  const month = today.slice(0, 7)
  if (keys.some(k => k.slice(0, 7) === month)) return null
  return keys.find(k => k >= today) ?? keys[keys.length - 1]
}

/* ── moving one ─────────────────────────────────────────────────────────── */

/**
 * May this person drag this event onto another day?
 *
 * The presentation half of a rule the API enforces for real: an item's due
 * date is the owner's and their managers' business, and a shoot date stops
 * being anybody's the moment it is locked. A client never moves anything —
 * the calendar is a window for them, not a control.
 *
 * Hiding the handle is politeness, not security: the server refuses in its
 * own words, and the calendar shows that refusal rather than inventing one.
 */
export function canMove(
  e: Pick<CalEvent, 'moveField' | 'ownerId' | 'locked'>,
  v: Viewer | null,
): boolean {
  if (!v || !e.moveField) return false
  if (v.role === 'client') return false
  if (e.moveField === 'shoot_date' && e.locked) return false
  if (isManager(v.role)) return true
  return !!e.ownerId && e.ownerId === v.id
}

/** The body a move sends — the field the event says it owns, nothing else. */
export function movePatch(e: Pick<CalEvent, 'moveField'>, day: string): Record<string, string> | null {
  return e.moveField ? { [e.moveField]: day } : null
}

/** Where a move is sent. A shoot is a batch; everything else is an item. */
export function moveUrl(e: Pick<CalEvent, 'kind' | 'entityId'>): string {
  return e.kind === 'shoot'
    ? `/api/production/batches/${e.entityId}`
    : `/api/production/items/${e.entityId}`
}
