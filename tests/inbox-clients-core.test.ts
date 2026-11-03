import { describe, it, expect } from 'vitest'
import { rankClients, agoLabel } from '../app/lib/inbox-clients-core'

const c = (id: string, name: string) => ({ id, name, accounts: [] })
const now = new Date('2026-11-03T08:00:00Z')

describe('the Inbox client list: newest activity first (3 Nov 2026)', () => {
  it('puts the client with the latest comment or message on top, and silent clients last by name', () => {
    const out = rankClients(
      [c('a', 'Alia'), c('b', 'Basfoods'), c('z', 'Zed'), c('m', 'MGMT')],
      [
        { client_id: 'a', last_at: '2026-11-02T01:00:00Z', kind: 'comment' },
        { client_id: 'b', last_at: '2026-11-03T07:50:00Z', kind: 'message' },
        { client_id: 'a', last_at: '2026-11-03T06:00:00Z', kind: 'message' },
      ],
      [], now,
    )
    expect(out.map(x => x.id)).toEqual(['b', 'a', 'm', 'z'])
    expect(out[0]).toMatchObject({ last_at: '2026-11-03T07:50:00Z', last_kind: 'message' })
    expect(out[2].last_at).toBeNull()
  })

  it('counts new people since THIS person last opened the client', () => {
    const out = rankClients(
      [c('a', 'Alia')],
      [
        { client_id: 'a', last_at: '2026-11-03T05:00:00Z' },
        { client_id: 'a', last_at: '2026-11-03T07:00:00Z' },
        { client_id: 'a', last_at: '2026-11-03T07:30:00Z' },
      ],
      [{ client_id: 'a', seen_at: '2026-11-03T06:00:00Z' }], now,
    )
    expect(out[0].new_count).toBe(2)
  })

  it('a client never opened counts the last day only, not its whole history', () => {
    const out = rankClients(
      [c('a', 'Alia')],
      [
        { client_id: 'a', last_at: '2026-10-01T00:00:00Z' },
        { client_id: 'a', last_at: '2026-11-03T07:00:00Z' },
      ],
      [], now,
    )
    expect(out[0].new_count).toBe(1)
  })

  it('reads the time short', () => {
    expect(agoLabel(null, now)).toBe('No activity yet')
    expect(agoLabel('2026-11-03T07:59:30Z', now)).toBe('just now')
    expect(agoLabel('2026-11-03T07:56:00Z', now)).toBe('4 min ago')
    expect(agoLabel('2026-11-03T05:00:00Z', now)).toBe('3 h ago')
    expect(agoLabel('2026-11-01T08:00:00Z', now)).toBe('2 d ago')
  })
})
