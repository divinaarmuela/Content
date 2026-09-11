import { describe, expect, it } from 'vitest'
import {
  contractedFor, monthKeyIn, monthStages, NO_STAGES_THIS_MONTH, PRODUCED_STATUSES, stagesLine, stagesTone,
} from '../app/lib/overview-stages-core'

/* ── the playbook's three counted stages, per client, this month ── */

const TZ = 'Australia/Melbourne'
const NOW = '2026-09-11T05:00:00Z' // Fri 11 Sept, 3 pm Melbourne

const clients = [
  { id: 'acme', name: 'Acme', timezone: TZ },
  { id: 'zeta', name: 'Zeta', timezone: 'Pacific/Auckland' },
  { id: 'idle', name: 'Idle', timezone: TZ },
]

const act = (id: string, to: string, at: string) => ({
  entity_type: 'content_item', entity_id: id, action: 'status_change', new_value: to, created_at: at,
})

describe('monthStages', () => {
  it('counts produced from the first move into the quality check or later, delivered from the stamp, published from the log', () => {
    const rows = monthStages({
      now: NOW,
      items: [
        { id: 'a', client_id: 'acme', status: 'published', delivered_at: '2026-09-03T00:00:00Z' },
        { id: 'b', client_id: 'acme', status: 'quality_check', delivered_at: null },
        { id: 'c', client_id: 'acme', status: 'client_review', delivered_at: '2026-08-30T00:00:00Z' }, // August delivery
        { id: 'd', client_id: 'zeta', status: 'approved_for_scheduling', delivered_at: '2026-09-10T00:00:00Z' },
      ],
      activity: [
        act('a', 'internal_review', '2026-08-28T00:00:00Z'),
        act('a', 'quality_check', '2026-09-01T00:00:00Z'),
        act('a', 'client_review', '2026-09-03T00:00:00Z'),
        act('a', 'published', '2026-09-09T00:00:00Z'),
        act('b', 'quality_check', '2026-09-10T00:00:00Z'),
        act('c', 'quality_check', '2026-08-29T00:00:00Z'), // produced in August
      ],
      clients, commitments: [{ client_id: 'acme', month: 9, year: 2026, reel_quota: 4, story_quota: 2 }],
      clientIds: null, defaultTz: TZ,
    })
    expect(rows).toEqual([
      { client_id: 'acme', client_name: 'Acme', contracted: 6, produced: 2, delivered: 1, published: 1 },
      // d has no activity row: its delivery stamp says it was produced this month
      { client_id: 'zeta', client_name: 'Zeta', contracted: null, produced: 1, delivered: 1, published: 0 },
    ])
    // a client with nothing this month and no agreement line is not a row
    expect(rows.find(r => r.client_id === 'idle')).toBeUndefined()
  })

  it('an account manager sees only their clients', () => {
    const rows = monthStages({
      now: NOW,
      items: [{ id: 'x', client_id: 'acme', delivered_at: '2026-09-02T00:00:00Z' }, { id: 'y', client_id: 'zeta', delivered_at: '2026-09-02T00:00:00Z' }],
      activity: [], clients, commitments: [], clientIds: ['zeta'], defaultTz: TZ,
    })
    expect(rows.map(r => r.client_id)).toEqual(['zeta'])
  })

  it('places a stamp in the month on the client’s own calendar', () => {
    // 31 Aug 23:30 UTC is 1 Sept in Melbourne
    expect(monthKeyIn('2026-08-31T23:30:00Z', TZ)).toBe('2026-09')
    expect(monthKeyIn('2026-08-31T23:30:00Z', 'UTC')).toBe('2026-08')
    expect(monthKeyIn('not a date', TZ)).toBeNull()
    expect(monthKeyIn(null, TZ)).toBeNull()
  })

  it('sums every quota line of the month’s commitment, and says null with none', () => {
    const rows = [{ client_id: 'acme', month: 9, year: 2026, reel_quota: 4, carousel_quota: 1, other_quota: null }]
    expect(contractedFor(rows, 'acme', '2026-09')).toBe(5)
    expect(contractedFor(rows, 'acme', '2026-10')).toBeNull()
    expect(contractedFor(rows, 'zeta', '2026-09')).toBeNull()
  })

  it('says the three words, in the playbook’s order, and no synonym', () => {
    expect(stagesLine({ client_id: 'a', client_name: 'Acme', contracted: 4, produced: 5, delivered: 3, published: 2 }))
      .toBe('3 of 4 delivered · 5 produced · 2 published')
    expect(stagesLine({ client_id: 'a', client_name: 'Acme', contracted: null, produced: 1, delivered: 1, published: 0 }))
      .toBe('1 delivered · 1 produced · 0 published')
    expect(NO_STAGES_THIS_MONTH).toMatch(/produced, delivered or published/)
    expect(PRODUCED_STATUSES[0]).toBe('quality_check')
  })

  it('turns amber only when the month is mostly gone and delivery is short', () => {
    const short = { client_id: 'a', client_name: 'Acme', contracted: 4, produced: 1, delivered: 1, published: 0 }
    expect(stagesTone(short, '2026-09-11T05:00:00Z', TZ)).toBe('muted')
    expect(stagesTone(short, '2026-09-25T05:00:00Z', TZ)).toBe('amber')
    expect(stagesTone({ ...short, delivered: 4 }, '2026-09-25T05:00:00Z', TZ)).toBe('green')
    expect(stagesTone({ ...short, contracted: null }, '2026-09-25T05:00:00Z', TZ)).toBe('muted')
  })
})
