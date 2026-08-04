import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  verifySignature, dedupKey, normalizeEvent, normalizeBatch, isHeartbeat,
  webhookLooksDead, retryAfterMs, dayKeyInTz, isOverdue, rollupByPerson,
  rangeFromDays, matchClient, type RawAsanaEvent,
} from '../app/lib/asana-core'

const sign = (body: string, secret: string) =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex')

const EVENT: RawAsanaEvent = {
  user: { gid: 'u1' },
  created_at: '2026-08-04T01:00:00.000Z',
  action: 'changed',
  resource: { gid: 't1', resource_type: 'task' },
  change: { field: 'completed', action: 'changed' },
}

describe('verifySignature', () => {
  const body = '{"events":[{"action":"changed"}]}'

  it('accepts a correct signature', () => {
    expect(verifySignature(body, 'sec', sign(body, 'sec'))).toBe(true)
  })

  it('rejects a wrong secret, a tampered body, and a missing header', () => {
    expect(verifySignature(body, 'sec', sign(body, 'other'))).toBe(false)
    expect(verifySignature(body + ' ', 'sec', sign(body, 'sec'))).toBe(false)
    expect(verifySignature(body, 'sec', null)).toBe(false)
    expect(verifySignature(body, '', sign(body, 'sec'))).toBe(false)
  })

  it('rejects a short signature without throwing', () => {
    // timingSafeEqual throws on length mismatch — must be guarded
    expect(() => verifySignature(body, 'sec', 'abc')).not.toThrow()
    expect(verifySignature(body, 'sec', 'abc')).toBe(false)
  })

  it('is sensitive to key order, so the raw body must be used', () => {
    const reserialised = JSON.stringify(JSON.parse(body))
    const sig = sign(body, 'sec')
    expect(verifySignature(body, 'sec', sig)).toBe(true)
    if (reserialised !== body) expect(verifySignature(reserialised, 'sec', sig)).toBe(false)
  })
})

describe('dedupKey', () => {
  it('is stable for the same event', () => {
    expect(dedupKey(EVENT, 'p1')).toBe(dedupKey(EVENT, 'p1'))
  })

  it('separates events differing in any identifying field', () => {
    const keys = new Set([
      dedupKey(EVENT, 'p1'),
      dedupKey({ ...EVENT, action: 'added' }, 'p1'),
      dedupKey({ ...EVENT, user: { gid: 'u2' } }, 'p1'),
      dedupKey({ ...EVENT, resource: { gid: 't2' } }, 'p1'),
      dedupKey({ ...EVENT, change: { field: 'assignee' } }, 'p1'),
      dedupKey(EVENT, 'p2'),
    ])
    expect(keys.size).toBe(6)
  })
})

describe('normalizeEvent', () => {
  it('maps the Asana shape onto a row', () => {
    const row = normalizeEvent(EVENT, { projectGid: 'p1', source: 'webhook' })
    expect(row).toMatchObject({
      user_gid: 'u1', resource_gid: 't1', resource_type: 'task',
      action: 'changed', change_field: 'completed', project_gid: 'p1', source: 'webhook',
    })
  })

  it('drops events with no resource or no timestamp', () => {
    expect(normalizeEvent({ ...EVENT, resource: null }, { source: 'poll' })).toBeNull()
    expect(normalizeEvent({ ...EVENT, created_at: undefined }, { source: 'poll' })).toBeNull()
  })

  it('tolerates a missing user (Asana omits it for system changes)', () => {
    const row = normalizeEvent({ ...EVENT, user: null }, { source: 'poll' })
    expect(row?.user_gid).toBeNull()
  })
})

describe('normalizeBatch', () => {
  it('drops duplicates inside one payload and keeps distinct events', () => {
    const rows = normalizeBatch(
      [EVENT, EVENT, { ...EVENT, resource: { gid: 't2' } }, { ...EVENT, resource: null }],
      { projectGid: 'p1', source: 'poll' }
    )
    expect(rows).toHaveLength(2)
  })

  it('gives webhook and poll the same key, so the overlap dedups in the database', () => {
    const [viaHook] = normalizeBatch([EVENT], { projectGid: 'p1', source: 'webhook' })
    const [viaPoll] = normalizeBatch([EVENT], { projectGid: 'p1', source: 'poll' })
    expect(viaHook.dedup_key).toBe(viaPoll.dedup_key)
  })
})

describe('heartbeats and webhook health', () => {
  it('recognises an empty events array', () => {
    expect(isHeartbeat({ events: [] })).toBe(true)
    expect(isHeartbeat({ events: [EVENT] })).toBe(false)
    expect(isHeartbeat(null)).toBe(false)
    expect(isHeartbeat({})).toBe(false)
  })

  it('treats silence beyond the grace window as dead', () => {
    const now = new Date('2026-08-04T12:00:00Z')
    expect(webhookLooksDead('2026-08-04T11:00:00Z', now)).toBe(false)
    expect(webhookLooksDead('2026-08-03T12:00:00Z', now)).toBe(true)
    expect(webhookLooksDead(null, now)).toBe(true)
  })
})

describe('retryAfterMs', () => {
  it('reads seconds, clamps, and falls back', () => {
    expect(retryAfterMs('5')).toBe(5000)
    expect(retryAfterMs('0')).toBe(0)
    expect(retryAfterMs('99999')).toBe(60_000)
    expect(retryAfterMs(null)).toBe(1000)
    expect(retryAfterMs('not-a-date', 250)).toBe(250)
  })
})

describe('timezone handling', () => {
  it('resolves the local day, not the UTC day', () => {
    // 23:30 UTC on the 3rd is already the 4th in Melbourne
    const instant = '2026-08-03T23:30:00Z'
    expect(dayKeyInTz(instant, 'Australia/Melbourne')).toBe('2026-08-04')
    expect(dayKeyInTz(instant, 'UTC')).toBe('2026-08-03')
  })

  it('falls back to UTC for a nonsense zone rather than throwing', () => {
    expect(() => dayKeyInTz('2026-08-03T23:30:00Z', 'Not/AZone')).not.toThrow()
  })

  it('only counts a task overdue once the local day has passed it', () => {
    const now = new Date('2026-08-03T23:30:00Z') // 4 Aug in Melbourne, 3 Aug UTC
    const task = { due_on: '2026-08-03', completed: false }
    expect(isOverdue(task, now, 'Australia/Melbourne')).toBe(true)
    expect(isOverdue(task, now, 'UTC')).toBe(false)
  })

  it('never marks completed or undated tasks overdue', () => {
    const now = new Date('2026-09-01T00:00:00Z')
    expect(isOverdue({ due_on: '2026-08-01', completed: true }, now, 'UTC')).toBe(false)
    expect(isOverdue({ due_on: null, completed: false }, now, 'UTC')).toBe(false)
  })
})

describe('rollupByPerson', () => {
  const now = new Date('2026-08-04T12:00:00Z')
  const people = [
    { id: 'a', name: 'Akmal', email: 'a@x.com', employment_type: 'employee' as const,
      timezone: 'Australia/Melbourne', asana_user_gid: 'u1' },
    { id: 'b', name: 'Divina', email: 'd@x.com', employment_type: 'contractor' as const,
      timezone: 'UTC', asana_user_gid: null },
  ]
  const tasks = [
    { gid: 't1', assignee_gid: 'u1', completed: true,  completed_at: '2026-08-03T10:00:00Z', due_on: null },
    { gid: 't2', assignee_gid: 'u1', completed: false, completed_at: null, due_on: '2026-08-01' },
    { gid: 't3', assignee_gid: 'u1', completed: false, completed_at: null, due_on: '2026-12-01' },
    { gid: 't4', assignee_gid: 'u9', completed: false, completed_at: null, due_on: '2026-01-01' },
  ]
  const events = [
    { user_gid: 'u1', created_at: '2026-08-03T10:00:00Z' },
    { user_gid: 'u1', created_at: '2026-08-04T09:00:00Z' },
    { user_gid: 'u1', created_at: '2020-01-01T00:00:00Z' }, // outside range
    { user_gid: null, created_at: '2026-08-04T09:00:00Z' }, // system event
  ]
  const run = () => rollupByPerson({
    people, tasks, events, from: '2026-08-01T00:00:00Z', to: '2026-08-05T00:00:00Z', now,
  })

  it('counts completed, open and overdue from the task mirror', () => {
    const [akmal] = run()
    expect(akmal.completed).toBe(1)
    expect(akmal.open).toBe(2)
    expect(akmal.overdue).toBe(1)
  })

  it('counts only in-range events and reports the latest', () => {
    const [akmal] = run()
    expect(akmal.eventCount).toBe(2)
    expect(akmal.lastActivityAt).toBe('2026-08-04T09:00:00Z')
  })

  it('ignores other people’s tasks', () => {
    const [akmal] = run()
    expect(akmal.open).toBe(2) // t4 belongs to u9
  })

  it('marks an unlinked person rather than silently zeroing them', () => {
    const [, divina] = run()
    expect(divina.linked).toBe(false)
    expect(divina.completed).toBe(0)
    expect(divina.lastActivityAt).toBeNull()
  })

  it('keeps employment type, for the employee/contractor distinction', () => {
    expect(run().map(p => p.employment_type)).toEqual(['employee', 'contractor'])
  })
})

describe('matchClient', () => {
  // the real lists from this workspace — they agree in substance, not spelling
  const clients = [
    { id: 'c1', name: 'Alia Fragrance' },
    { id: 'c2', name: "Cecconi's Toorak & Flinders" },
    { id: 'c3', name: 'Park Noire' },
    { id: 'c4', name: 'Stretchworks' },
    { id: 'c5', name: 'Real Deal' },
    { id: 'c6', name: 'Pattons' },
    { id: 'c7', name: 'test' },
  ]

  it('matches across punctuation, case and pluralisation', () => {
    expect(matchClient('ALIA Fragrances', clients)?.id).toBe('c1')
    expect(matchClient('Park-Noire', clients)?.id).toBe('c3')
    expect(matchClient('StretchWorks', clients)?.id).toBe('c4')
    expect(matchClient('Pattons', clients)?.id).toBe('c6')
  })

  it('matches when either side is the longer form', () => {
    expect(matchClient('Cecconis', clients)?.id).toBe('c2')          // client is longer
    expect(matchClient('Real Deal Property', clients)?.id).toBe('c5') // project is longer
  })

  it('returns null rather than guessing', () => {
    expect(matchClient('- Tech Team', clients)).toBeNull()
    expect(matchClient('Project Template', clients)).toBeNull()
    expect(matchClient('MGMT', clients)).toBeNull()
  })

  it('ignores names too short to be evidence', () => {
    // 'test' would otherwise match half the list on containment
    expect(matchClient('- Ads', clients)).toBeNull()
    expect(matchClient('Automodellista', clients)).toBeNull()
  })
})

describe('rangeFromDays', () => {
  it('covers whole days back from now', () => {
    const { from, to } = rangeFromDays(7, new Date('2026-08-04T12:00:00Z'))
    expect(from).toBe('2026-07-29T00:00:00.000Z')
    expect(to).toBe('2026-08-04T12:00:00.000Z')
  })

  it('treats a single day as today only', () => {
    const { from } = rangeFromDays(1, new Date('2026-08-04T12:00:00Z'))
    expect(from).toBe('2026-08-04T00:00:00.000Z')
  })
})
