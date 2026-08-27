import { describe, it, expect } from 'vitest'
import {
  CLIENT_TONES, canMove, clientTone, dayLabel, eventsFor, instantDayKey, monthGrid,
  monthLabel, movePatch, moveUrl, orderEvents, plainDayKey, shiftDay, shiftMonth,
  statusWordFor, suggestedDay, todayKey, weekGrid, weekLabel, weekdayIndex,
  type CalBatch, type CalEntry, type CalEvent, type CalItem,
} from '../app/lib/work-calendar-core'
import { BATCH_STATUS_LABEL } from '../app/lib/batch-brief-core'
import type { Viewer } from '../app/lib/work-pages-core'
import type { Role } from '../app/lib/identity-core'

const MELBOURNE = 'Australia/Melbourne'
const MANILA = 'Asia/Manila'
const LONDON = 'Europe/London'

const viewer = (role: Role, id = 'me'): Viewer => ({ id, role })

const item = (over: Partial<CalItem> = {}): CalItem => ({
  id: 'i1', title: 'A reel', status: 'draft_uploaded', due_date: null,
  owner_id: null, client_id: 'c1', content_type: 'reel',
  clients: { name: 'Acme', timezone: MELBOURNE }, ...over,
})
const brief = (over: Partial<CalItem> = {}) =>
  item({ work_kinds: { slug: 'shoot_brief', name: 'Shoot brief' }, ...over })
const task = (over: Partial<CalItem> = {}) =>
  item({ work_kinds: { slug: 'research', name: 'Research', uses_media: false }, ...over })

const batch = (over: Partial<CalBatch> = {}): CalBatch => ({
  id: 'b1', title: 'September studio day', status: 'brief', shoot_date: null,
  client_id: 'c1', clients: { name: 'Acme' }, ...over,
})

const entry = (over: Partial<CalEntry> = {}): CalEntry => ({
  id: 'e1', item_id: 'i1', platform: 'instagram', scheduled_at: null,
  publish_status: 'scheduled',
  content_items: { title: 'A reel', client_id: 'c1', clients: { name: 'Acme', timezone: MELBOURNE } },
  ...over,
})

/* ── day keys: the whole point of the module ─────────────────────────────── */

describe('a due date is a plain date and is never parsed as an instant', () => {
  it('takes the ten characters as written', () => {
    expect(plainDayKey('2026-08-27')).toBe('2026-08-27')
    expect(plainDayKey('2026-08-27T00:00:00Z')).toBe('2026-08-27')
  })

  it('is null for nothing, and for anything that is not a date', () => {
    expect(plainDayKey(null)).toBeNull()
    expect(plainDayKey('')).toBeNull()
    expect(plainDayKey('soon')).toBeNull()
  })

  it('does not shift a day west of UTC — the bug this replaces', () => {
    // read as an instant, 2026-08-27 is midnight UTC, which is the 26th in
    // Los Angeles. A due date has no instant behind it and must not move.
    const events = eventsFor('editor', { items: [item({ due_date: '2026-08-27' })] }, 'America/Los_Angeles')
    expect([...events.byDay.keys()]).toEqual(['2026-08-27'])
  })
})

describe('a posting time is filed in the CLIENT’s zone, whoever is reading', () => {
  // 9 am Thursday 27 August in Melbourne
  const nineAmMelbourne = '2026-08-26T23:00:00.000Z'

  it('a Melbourne client’s 9 am post is Thursday the 27th', () => {
    expect(instantDayKey(nineAmMelbourne, MELBOURNE)).toBe('2026-08-27')
  })

  it('…and it is STILL the 27th for a scheduler sitting in Manila', () => {
    const events = eventsFor('scheduler', {
      entries: [entry({ scheduled_at: nineAmMelbourne })],
    }, MANILA)
    // the fallback zone is Manila; the client's own zone wins over it
    expect([...events.byDay.keys()]).toEqual(['2026-08-27'])
  })

  it('…and it is still the 26th in Los Angeles, which is why the client’s zone is the one that counts', () => {
    expect(instantDayKey(nineAmMelbourne, 'America/Los_Angeles')).toBe('2026-08-26')
    // London is on BST in August, so it has already ticked over — a reminder
    // that "one day behind" is not a property of a zone, it is a property of
    // an instant, and only the client's own calendar settles it
    expect(instantDayKey(nineAmMelbourne, LONDON)).toBe('2026-08-27')
  })

  it('a client with no zone of its own falls back to the zone passed in', () => {
    const events = eventsFor('scheduler', {
      entries: [entry({
        scheduled_at: nineAmMelbourne,
        content_items: { title: 'A reel', client_id: 'c1', clients: { name: 'Acme', timezone: null } },
      })],
    }, MELBOURNE)
    expect([...events.byDay.keys()]).toEqual(['2026-08-27'])
  })

  it('an 11 pm Melbourne post on the 31st is August, not September', () => {
    // 2026-08-31 23:00 Melbourne = 2026-08-31T13:00Z
    expect(instantDayKey('2026-08-31T13:00:00.000Z', MELBOURNE)).toBe('2026-08-31')
    expect(instantDayKey('2026-08-31T13:00:00.000Z', 'UTC')).toBe('2026-08-31')
    // …and a post an hour later has crossed over for the client
    expect(instantDayKey('2026-08-31T14:00:00.000Z', MELBOURNE)).toBe('2026-09-01')
  })
})

/* ── the month grid ─────────────────────────────────────────────────────── */

describe('the month grid', () => {
  it('starts on a Monday and runs in whole weeks', () => {
    const cells = monthGrid(2026, 8)
    expect(cells.length % 7).toBe(0)
    expect(weekdayIndex(cells[0].key)).toBe(0)
    expect(weekdayIndex(cells[cells.length - 1].key)).toBe(6)
  })

  it('covers every day of the month exactly once', () => {
    for (const [y, m, days] of [[2026, 8, 31], [2026, 2, 28], [2024, 2, 29], [2026, 4, 30]] as const) {
      const inMonth = monthGrid(y, m).filter(c => c.inMonth)
      expect(inMonth.length, `${y}-${m}`).toBe(days)
      expect(new Set(inMonth.map(c => c.key)).size).toBe(days)
    }
  })

  it('borrows the days either side and marks them as borrowed', () => {
    // 1 August 2026 is a Saturday, so the grid opens on Monday 27 July
    const cells = monthGrid(2026, 8)
    expect(cells[0].key).toBe('2026-07-27')
    expect(cells[0].inMonth).toBe(false)
    expect(cells.find(c => c.key === '2026-08-01')?.inMonth).toBe(true)
  })

  it('drops a trailing week made entirely of the next month', () => {
    // February 2027 starts on a Monday and has 28 days: exactly four weeks,
    // so the grid must not carry two rows of March
    const cells = monthGrid(2027, 2)
    expect(cells.length).toBe(35)
    expect(cells.some(c => c.inMonth)).toBe(true)
    expect(cells.slice(28).every(c => !c.inMonth)).toBe(true)
  })

  it('gives six rows when a month genuinely needs them', () => {
    // 1 May 2027 is a Saturday; 31 days pushes the last day into a sixth row
    expect(monthGrid(2027, 5).length).toBe(42)
  })

  it('crosses a DST boundary without repeating or skipping a day', () => {
    // Melbourne's clocks go forward on 4 October; a grid built by adding 24
    // local hours produces the 4th twice. The grid is UTC arithmetic.
    const keys = monthGrid(2026, 10).map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain('2026-10-04')
    // …and the same at the April end, where an hour happens twice
    const april = monthGrid(2026, 4).map(c => c.key)
    expect(new Set(april).size).toBe(april.length)
  })

  it('rolls a year over at both edges', () => {
    expect(monthGrid(2026, 1).some(c => c.key.startsWith('2025-12'))).toBe(true)
    expect(monthGrid(2026, 12).some(c => c.key.startsWith('2027-01'))).toBe(true)
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
  })
})

describe('the week grid', () => {
  it('is the Monday-first week containing the day', () => {
    const cells = weekGrid('2026-08-27') // a Thursday
    expect(cells.map(c => c.key)).toEqual([
      '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
      '2026-08-28', '2026-08-29', '2026-08-30',
    ])
  })

  it('is the same week whichever of its days you ask with', () => {
    const monday = weekGrid('2026-08-24').map(c => c.key)
    for (const d of monday) expect(weekGrid(d).map(c => c.key)).toEqual(monday)
  })

  it('spans a month boundary', () => {
    expect(weekGrid('2026-09-01').map(c => c.key)[0]).toBe('2026-08-31')
  })
})

describe('day arithmetic is exact', () => {
  it('steps forward and back across months, years and DST', () => {
    expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2026-10-03', 1)).toBe('2026-10-04') // Melbourne DST start
    expect(shiftDay('2026-08-27', 7)).toBe('2026-09-03')
    expect(shiftDay('2026-08-27', -7)).toBe('2026-08-20')
  })

  it('leaves a value it cannot read alone rather than inventing a day', () => {
    expect(shiftDay('later', 1)).toBe('later')
  })
})

describe('labels', () => {
  it('names the month and the week without slipping a day', () => {
    expect(monthLabel(2026, 8)).toContain('August')
    expect(monthLabel(2026, 8)).toContain('2026')
    expect(dayLabel('2026-08-27')).toBe('Thu 27 Aug')
    expect(weekLabel(weekGrid('2026-08-27'))).toContain('24')
  })
})

describe('today', () => {
  it('is the day in the zone the page plans in, not the machine’s', () => {
    // 9 am Melbourne on the 27th is still the evening of the 26th in New York
    const at = new Date('2026-08-26T23:00:00.000Z')
    expect(todayKey(MELBOURNE, at)).toBe('2026-08-27')
    expect(todayKey('America/New_York', at)).toBe('2026-08-26')
  })
})

/* ── the events themselves ──────────────────────────────────────────────── */

describe('eventsFor — Production', () => {
  const source = {
    batches: [
      batch({ id: 'b1', shoot_date: '2026-08-27' }),
      batch({ id: 'b2', shoot_date: null, title: 'Unscheduled day' }),
      batch({ id: 'b3', shoot_date: '2026-08-27', status: 'locked', title: 'Locked day' }),
    ],
    items: [
      brief({ id: 'br1', due_date: '2026-08-27', title: 'Brief' }),
      task({ id: 't1', due_date: null, title: 'Research' }),
      item({ id: 'a1', due_date: '2026-08-27', title: 'An asset' }),
    ],
  }
  const { byDay, undated } = eventsFor('production', source)

  it('shows shoots, briefs and tasks — and never an asset', () => {
    expect(byDay.get('2026-08-27')?.map(e => e.kind)).toEqual(['shoot', 'shoot', 'brief'])
    expect([...byDay.values()].flat().some(e => e.kind === 'asset')).toBe(false)
  })

  it('files everything with no date in the undated bucket', () => {
    expect(undated.map(e => e.title)).toEqual(['Unscheduled day', 'Research'])
  })

  it('a shoot carries its stage as a word, not a database status', () => {
    const shoot = byDay.get('2026-08-27')!.find(e => e.entityId === 'b3')!
    expect(shoot.statusWord).toBe(BATCH_STATUS_LABEL.locked)
    expect(shoot.statusWord).not.toContain('_')
  })

  it('only a shoot still in planning offers its date to a drag', () => {
    const planning = byDay.get('2026-08-27')!.find(e => e.entityId === 'b1')!
    const locked = byDay.get('2026-08-27')!.find(e => e.entityId === 'b3')!
    expect(planning.moveField).toBe('shoot_date')
    expect(planning.locked).toBe(false)
    expect(locked.moveField).toBeNull()
    expect(locked.locked).toBe(true)
  })

  it('links a shoot to the shoot page and an item to the item page', () => {
    expect(byDay.get('2026-08-27')!.find(e => e.entityId === 'b1')!.href)
      .toBe('/dashboard/production/shoots/b1')
    expect(byDay.get('2026-08-27')!.find(e => e.kind === 'brief')!.href)
      .toBe('/dashboard/production/br1')
  })
})

describe('eventsFor — Editor', () => {
  const { byDay, undated } = eventsFor('editor', {
    items: [
      item({ id: 'a1', due_date: '2026-08-27' }),
      item({ id: 'a2', due_date: null, title: 'No date' }),
      brief({ id: 'br1', due_date: '2026-08-27' }),
      task({ id: 't1', due_date: '2026-08-27' }),
    ],
    // a batch handed in by mistake is not the editor board's business
    batches: [batch({ shoot_date: '2026-08-27' })],
  })

  it('shows assets and nothing else', () => {
    expect([...byDay.values()].flat().map(e => e.entityId)).toEqual(['a1'])
  })

  it('undated assets go to the tray', () => {
    expect(undated.map(e => e.entityId)).toEqual(['a2'])
  })

  it('an asset says which step it is on, in the board’s own words', () => {
    expect(byDay.get('2026-08-27')![0].statusWord).toBe('Drafting')
  })
})

describe('eventsFor — Scheduler', () => {
  const { byDay } = eventsFor('scheduler', {
    entries: [entry({ id: 'e1', scheduled_at: '2026-08-26T23:00:00.000Z' })],
    items: [item({ id: 'i9', due_date: '2026-08-27', status: 'approved_for_scheduling' })],
  }, MELBOURNE)

  const day = byDay.get('2026-08-27')!

  it('puts what posts and what is due on the same day', () => {
    expect(day.map(e => e.kind)).toEqual(['post', 'asset'])
  })

  it('the due layer is marked as the quieter one', () => {
    expect(day.find(e => e.kind === 'post')!.layer).toBe('main')
    expect(day.find(e => e.kind === 'asset')!.layer).toBe('due')
  })

  it('a posting time is never dragged — it is set with its zone and platform', () => {
    expect(day.find(e => e.kind === 'post')!.moveField).toBeNull()
    expect(day.find(e => e.kind === 'asset')!.moveField).toBe('due_date')
  })

  it('a published entry carries its live link and reads as published', () => {
    const { byDay: live } = eventsFor('scheduler', {
      entries: [entry({
        scheduled_at: '2026-08-26T23:00:00.000Z',
        publish_status: 'published', live_url: 'https://example.test/p/1',
      })],
    }, MELBOURNE)
    const e = live.get('2026-08-27')![0]
    expect(e.live).toBe(true)
    expect(e.liveUrl).toBe('https://example.test/p/1')
    expect(e.statusWord).toBe('Published')
  })
})

/* ── ordering ───────────────────────────────────────────────────────────── */

describe('ordering inside a day', () => {
  const at = (uid: string, over: Partial<CalEvent> = {}): CalEvent => ({
    uid, entityId: uid, kind: 'task', layer: 'main', day: '2026-08-27', at: null,
    title: uid, clientId: 'c1', clientName: 'Acme', clientTz: MELBOURNE,
    typeChip: 'Task', statusWord: 'To do', tone: 'zinc', href: '/x',
    moveField: 'due_date', ownerId: null, locked: false, ...over,
  })

  it('times come first, in time order', () => {
    const out = orderEvents([
      at('c'),
      at('b', { kind: 'post', at: '2026-08-27T05:00:00Z' }),
      at('a', { kind: 'post', at: '2026-08-27T01:00:00Z' }),
    ])
    expect(out.map(e => e.uid)).toEqual(['a', 'b', 'c'])
  })

  it('the main layer sits above the due layer', () => {
    const out = orderEvents([at('due', { layer: 'due' }), at('main')])
    expect(out.map(e => e.uid)).toEqual(['main', 'due'])
  })

  it('shoots lead, then briefs, then the work', () => {
    const out = orderEvents([
      at('t', { kind: 'task' }), at('a', { kind: 'asset' }),
      at('s', { kind: 'shoot' }), at('b', { kind: 'brief' }),
    ])
    expect(out.map(e => e.kind)).toEqual(['shoot', 'brief', 'asset', 'task'])
  })

  it('is stable — the same input never draws in two orders', () => {
    const list = [at('z'), at('a'), at('m')]
    expect(orderEvents(list).map(e => e.uid)).toEqual(orderEvents([...list].reverse()).map(e => e.uid))
  })

  it('does not mutate what it was given', () => {
    const list = [at('z'), at('a')]
    orderEvents(list)
    expect(list.map(e => e.uid)).toEqual(['z', 'a'])
  })
})

/* ── who may move what ──────────────────────────────────────────────────── */

describe('canMove', () => {
  const due = (over: Partial<CalEvent> = {}) =>
    ({ moveField: 'due_date' as const, ownerId: null, locked: false, ...over })
  const shoot = (over: Partial<CalEvent> = {}) =>
    ({ moveField: 'shoot_date' as const, ownerId: null, locked: false, ...over })

  it('managers move anything that is movable', () => {
    for (const role of ['account_manager', 'super_admin'] as Role[]) {
      expect(canMove(due(), viewer(role))).toBe(true)
      expect(canMove(shoot(), viewer(role))).toBe(true)
    }
  })

  it('the owner moves their own', () => {
    expect(canMove(due({ ownerId: 'me' }), viewer('editor'))).toBe(true)
    expect(canMove(due({ ownerId: 'them' }), viewer('editor'))).toBe(false)
    expect(canMove(due(), viewer('editor'))).toBe(false)
  })

  it('a locked shoot date moves nowhere — not even for a super admin', () => {
    expect(canMove(shoot({ locked: true, moveField: null }), viewer('super_admin'))).toBe(false)
    // and belt-and-braces: a locked event that still claims the field
    expect(canMove(shoot({ locked: true }), viewer('super_admin'))).toBe(false)
  })

  it('a client never moves anything, even their own', () => {
    expect(canMove(due({ ownerId: 'me' }), viewer('client'))).toBe(false)
  })

  it('nothing immovable moves, and nobody signed out moves anything', () => {
    expect(canMove({ moveField: null, ownerId: 'me', locked: false }, viewer('super_admin'))).toBe(false)
    expect(canMove(due({ ownerId: 'me' }), null)).toBe(false)
  })
})

describe('where a move is sent, and what it says', () => {
  it('a shoot patches its batch; everything else patches its item', () => {
    expect(moveUrl({ kind: 'shoot', entityId: 'b1' })).toBe('/api/production/batches/b1')
    expect(moveUrl({ kind: 'task', entityId: 'i1' })).toBe('/api/production/items/i1')
  })

  it('sends only the field the event owns', () => {
    expect(movePatch({ moveField: 'due_date' }, '2026-08-27')).toEqual({ due_date: '2026-08-27' })
    expect(movePatch({ moveField: 'shoot_date' }, '2026-08-27')).toEqual({ shoot_date: '2026-08-27' })
    expect(movePatch({ moveField: null }, '2026-08-27')).toBeNull()
  })
})

/* ── the small stuff that still has a rule in it ────────────────────────── */

describe('client colour', () => {
  it('is the same colour for the same client, every time', () => {
    expect(clientTone('c1')).toBe(clientTone('c1'))
  })

  it('is always one of the palette, and never invented for nobody', () => {
    for (const id of ['c1', 'c2', 'abc-def', '']) expect(CLIENT_TONES).toContain(clientTone(id))
    expect(clientTone(null)).toBe('zinc')
  })

  it('spreads a handful of clients across more than one colour', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `client-${i}`)
    expect(new Set(ids.map(clientTone)).size).toBeGreaterThan(2)
  })
})

describe('status words come from the vocabulary, never from the database', () => {
  it('a brief, a task and an asset each get their own kind’s word', () => {
    expect(statusWordFor(brief({ status: 'client_review' }))).not.toBe('client_review')
    expect(statusWordFor(task({ status: 'draft_uploaded', current_version_number: 0 })))
      .toBe('Not started')
    expect(statusWordFor(item({ status: 'internal_review' }))).toBe('Ready for review')
  })

  it('no event anywhere prints an underscore', () => {
    const { byDay, undated } = eventsFor('production', {
      batches: [batch({ shoot_date: '2026-08-27' })],
      items: [brief({ due_date: '2026-08-27' }), task({ id: 't', due_date: null })],
    })
    for (const e of [...byDay.values()].flat().concat(undated)) {
      expect(e.statusWord, e.uid).not.toMatch(/_/)
      expect(e.typeChip, e.uid).not.toMatch(/_/)
    }
  })
})

describe('suggestedDay — which month to open on', () => {
  it('stays put when this month has something in it', () => {
    expect(suggestedDay(['2026-08-03', '2026-11-01'], '2026-08-27')).toBeNull()
  })

  it('goes to the next thing coming up when it does not', () => {
    expect(suggestedDay(['2026-05-01', '2026-11-01'], '2026-08-27')).toBe('2026-11-01')
  })

  it('falls back to the most recent thing behind when nothing is ahead', () => {
    expect(suggestedDay(['2026-05-01', '2026-06-01'], '2026-08-27')).toBe('2026-06-01')
  })

  it('has nothing to say about an empty calendar', () => {
    expect(suggestedDay([], '2026-08-27')).toBeNull()
    expect(suggestedDay([null, undefined], '2026-08-27')).toBeNull()
  })
})
