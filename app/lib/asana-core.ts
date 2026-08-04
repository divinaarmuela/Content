import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Pure Asana logic — no I/O, no Supabase, no fetch. Everything here is
 * unit-tested (`tests/asana-core.test.ts`); the wrappers in `asana.ts` do the
 * network and database work.
 *
 * Same split as workflow-core.ts / scan-core.ts. It matters more than usual
 * here because the interesting parts (signature verification, dedup keys,
 * timezone-correct day boundaries) are exactly the parts that are painful to
 * test against a live service.
 */

// ─── Webhook signature ───

/**
 * Verify Asana's `X-Hook-Signature`: HMAC-SHA256 over the **raw request body**,
 * keyed by the secret from the handshake.
 *
 * Must be given the raw text, not a re-serialised object — `JSON.parse` then
 * `JSON.stringify` can reorder keys or change spacing and the HMAC then fails
 * for entirely valid deliveries.
 */
export function verifySignature(rawBody: string, secret: string, signature: string | null): boolean {
  if (!secret || !signature) return false
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(signature, 'utf8')
  // timingSafeEqual throws on length mismatch, which would itself leak length
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ─── Events ───

export type AsanaAction = 'added' | 'changed' | 'removed' | 'deleted' | 'undeleted'

export type RawAsanaEvent = {
  user?: { gid?: string } | null
  created_at?: string
  action?: string
  resource?: { gid?: string; resource_type?: string } | null
  parent?: { gid?: string; resource_type?: string } | null
  change?: { field?: string; action?: string } | null
}

export type AsanaEventRow = {
  dedup_key: string
  created_at: string
  source: 'webhook' | 'poll'
  user_gid: string | null
  resource_gid: string
  resource_type: string
  action: string
  change_field: string | null
  project_gid: string | null
  raw: RawAsanaEvent
}

/**
 * Asana events carry no id of their own, so the dedup key is a hash of the
 * fields that identify one. This is what makes the webhook path and the
 * reconciliation poll safe to run over the same events: the unique constraint
 * on `dedup_key` absorbs the overlap.
 *
 * Deliberately a *unique constraint*, never check-then-write — same pattern as
 * `email_ingest_log.gmail_message_id`.
 */
export function dedupKey(e: RawAsanaEvent, projectGid?: string | null): string {
  const parts = [
    e.created_at ?? '',
    e.user?.gid ?? '',
    e.resource?.gid ?? '',
    e.action ?? '',
    e.change?.field ?? '',
    projectGid ?? '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

/** Shape one raw event into a row. Returns null for events we cannot key. */
export function normalizeEvent(
  e: RawAsanaEvent,
  opts: { projectGid?: string | null; source: 'webhook' | 'poll' }
): AsanaEventRow | null {
  const resourceGid = e.resource?.gid
  const createdAt = e.created_at
  if (!resourceGid || !createdAt) return null

  return {
    dedup_key: dedupKey(e, opts.projectGid),
    created_at: createdAt,
    source: opts.source,
    user_gid: e.user?.gid ?? null,
    resource_gid: resourceGid,
    resource_type: e.resource?.resource_type ?? '',
    action: e.action ?? '',
    change_field: e.change?.field ?? null,
    project_gid: opts.projectGid ?? null,
    raw: e,
  }
}

/** Normalize a delivery, dropping unkeyable events and in-payload duplicates. */
export function normalizeBatch(
  events: RawAsanaEvent[],
  opts: { projectGid?: string | null; source: 'webhook' | 'poll' }
): AsanaEventRow[] {
  const seen = new Set<string>()
  const rows: AsanaEventRow[] = []
  for (const e of events) {
    const row = normalizeEvent(e, opts)
    if (!row || seen.has(row.dedup_key)) continue
    seen.add(row.dedup_key)
    rows.push(row)
  }
  return rows
}

/** Asana sends `events: []` at handshake and roughly every 8 hours after. */
export function isHeartbeat(payload: { events?: unknown[] } | null | undefined): boolean {
  return !!payload && Array.isArray(payload.events) && payload.events.length === 0
}

/**
 * A webhook Asana has silently self-deleted looks exactly like a healthy one
 * that is simply quiet. Heartbeats are the only positive signal, so a missed
 * heartbeat window is what triggers re-registration. ~8h cadence, so 9h of
 * silence is dead rather than idle.
 */
export const HEARTBEAT_GRACE_MS = 9 * 60 * 60 * 1000

export function webhookLooksDead(lastHeartbeatAt: string | null, now: Date): boolean {
  if (!lastHeartbeatAt) return true
  return now.getTime() - new Date(lastHeartbeatAt).getTime() > HEARTBEAT_GRACE_MS
}

// ─── Rate limiting ───

/**
 * 429s carry `Retry-After` in seconds. Rejected requests still burn quota, so
 * honouring this is cheaper than retrying blind.
 */
export function retryAfterMs(header: string | null, fallbackMs = 1000): number {
  if (!header) return fallbackMs
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000)
  const at = Date.parse(header)
  if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 60_000))
  return fallbackMs
}

// ─── Timezone-correct days ───

/**
 * `YYYY-MM-DD` for an instant *as seen in a given timezone*. The rollup is
 * per-person and people are in different zones, so "today" and "overdue" are
 * only meaningful relative to the viewer's or subject's zone — comparing UTC
 * dates would mark a Melbourne task overdue while it is still due today there.
 */
export function dayKeyInTz(instant: Date | string, timeZone: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** A task is overdue when its due date is strictly before today, in the owner's zone. */
export function isOverdue(
  task: { due_on: string | null; completed: boolean },
  now: Date,
  timeZone: string
): boolean {
  if (task.completed || !task.due_on) return false
  return task.due_on < dayKeyInTz(now, timeZone)
}

// ─── Client mapping ───

/** Comparable form: case, punctuation and spacing carry no meaning here. */
function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Guess which client an Asana project belongs to.
 *
 * The two lists are maintained by different people in different tools, so they
 * agree in substance and disagree in spelling: "ALIA Fragrances" vs "Alia
 * Fragrance", "Park-Noire" vs "Park Noire", "Cecconis" vs "Cecconi's Toorak &
 * Flinders". Exact matching finds almost none of them.
 *
 * Containment either way handles both the shortened and the extended form.
 * The 4-character floor is what stops junk pairing: without it "test" matches
 * a dozen names. A wrong mapping silently misattributes a client's work, so
 * this only ever fills a blank — it never overwrites a mapping someone set by
 * hand — and returns null when unsure rather than guessing.
 */
export function matchClient<T extends { id: string; name: string }>(
  projectName: string,
  clients: T[]
): T | null {
  const p = normaliseName(projectName)
  if (p.length < 4) return null

  const candidates = clients
    .map(c => ({ c, n: normaliseName(c.name) }))
    .filter(x => x.n.length >= 4)

  const exact = candidates.find(x => x.n === p)
  if (exact) return exact.c

  // Longest overlap wins, so "Real Deal Property" prefers "Real Deal" over a
  // shorter incidental match.
  const contained = candidates
    .filter(x => x.n.includes(p) || p.includes(x.n))
    .sort((a, b) => Math.min(b.n.length, p.length) - Math.min(a.n.length, p.length))

  return contained[0]?.c ?? null
}

// ─── Rollup ───

export type RollupPerson = {
  id: string
  name: string
  email: string
  employment_type: 'employee' | 'contractor'
  timezone: string
  asana_user_gid: string | null
}

export type RollupTask = {
  gid: string
  assignee_gid: string | null
  completed: boolean
  completed_at: string | null
  due_on: string | null
}

export type RollupEvent = {
  user_gid: string | null
  created_at: string
}

export type PersonRollup = RollupPerson & {
  completed: number
  open: number
  overdue: number
  eventCount: number
  lastActivityAt: string | null
  linked: boolean
}

/**
 * Per-person rollup for the date range.
 *
 * `completed` comes from the task mirror's `completed_at`, not from counting
 * completion events: an event only says the `completed` field changed, so
 * un-completing a task would otherwise increment the count. The mirror holds
 * the resolved truth.
 *
 * `open` / `overdue` likewise cannot come from events at all — they are
 * statements about current state, which is why the task mirror exists.
 */
export function rollupByPerson(input: {
  people: RollupPerson[]
  tasks: RollupTask[]
  events: RollupEvent[]
  from: string
  to: string
  now: Date
}): PersonRollup[] {
  const { people, tasks, events, from, to, now } = input

  const tasksByAssignee = new Map<string, RollupTask[]>()
  for (const t of tasks) {
    if (!t.assignee_gid) continue
    const list = tasksByAssignee.get(t.assignee_gid)
    if (list) list.push(t)
    else tasksByAssignee.set(t.assignee_gid, [t])
  }

  const eventsByUser = new Map<string, RollupEvent[]>()
  for (const e of events) {
    if (!e.user_gid) continue
    if (e.created_at < from || e.created_at > to) continue
    const list = eventsByUser.get(e.user_gid)
    if (list) list.push(e)
    else eventsByUser.set(e.user_gid, [e])
  }

  return people.map(p => {
    const gid = p.asana_user_gid
    const theirTasks = gid ? tasksByAssignee.get(gid) ?? [] : []
    const theirEvents = gid ? eventsByUser.get(gid) ?? [] : []

    const open = theirTasks.filter(t => !t.completed)

    return {
      ...p,
      linked: !!gid,
      completed: theirTasks.filter(
        t => t.completed && t.completed_at && t.completed_at >= from && t.completed_at <= to
      ).length,
      open: open.length,
      overdue: open.filter(t => isOverdue(t, now, p.timezone)).length,
      eventCount: theirEvents.length,
      lastActivityAt: theirEvents.reduce<string | null>(
        (max, e) => (max === null || e.created_at > max ? e.created_at : max),
        null
      ),
    }
  })
}

/** Inclusive-day range as ISO instants, anchored in the viewer's timezone. */
export function rangeFromDays(days: number, now: Date): { from: string; to: string } {
  const to = new Date(now)
  const from = new Date(now.getTime() - Math.max(0, days - 1) * 24 * 60 * 60 * 1000)
  from.setUTCHours(0, 0, 0, 0)
  return { from: from.toISOString(), to: to.toISOString() }
}
