import { describe, expect, it } from 'vitest'
import { clientsOfMine, startsOnMine } from '../app/lib/clients-filter-core'
import { overviewTiles } from '../app/lib/board-view-core'

/**
 * MY CLIENTS (Manal, via the owner, 26 Nov 2026: "When I click overview and click 'your clients' says 6? Then I
 * click shows me everyone's"; the owner: "for am in clients make sure to show theirs … if 2 am show both").
 */
const c = (id: string, ...managers: string[]) => ({ id, name: id, managers: managers.map(m => ({ id: m, name: m, email: `${m}@x.invalid` })) })
const all = [c('bond', 'manal', 'divina', 'joy'), c('emerald', 'manal'), c('luxe', 'karly', 'sarina'), c('nobody')]

describe('which clients are mine', () => {
  it('the ones I am on — and a client with two managers is on both their lists', () => {
    expect(clientsOfMine(all, 'manal').map(x => x.id)).toEqual(['bond', 'emerald'])
    expect(clientsOfMine(all, 'divina').map(x => x.id)).toEqual(['bond'])
    expect(clientsOfMine(all, 'karly').map(x => x.id)).toEqual(['luxe'])
    expect(clientsOfMine(all, 'sarina').map(x => x.id)).toEqual(['luxe'])
  })
  it('none when I am on none, or when it is not known who I am', () => {
    expect(clientsOfMine(all, 'ed')).toEqual([])
    expect(clientsOfMine(all, null)).toEqual([])
    expect(clientsOfMine([{ managers: null }, {}], 'manal')).toEqual([])
  })
})

describe('what the Clients page opens on', () => {
  it('an account manager’s own clients; everyone’s for a super admin and the rest', () => {
    expect(startsOnMine('account_manager', '')).toBe(true)
    expect(startsOnMine('super_admin', '')).toBe(false)
    expect(startsOnMine('editor', '')).toBe(false)
    expect(startsOnMine(null, '')).toBe(false)
  })
  it('the link says so either way: the Overview’s "Your clients" opens on mine, whoever presses it', () => {
    expect(startsOnMine('super_admin', '?mine=1')).toBe(true)
    expect(startsOnMine('account_manager', '?mine=0')).toBe(false)
  })
})

describe('the Overview’s "Your clients" tile', () => {
  it('opens the Clients page on the clients it counted, not on everyone’s', () => {
    const tiles = overviewTiles({ viewer: { id: 'manal', role: 'account_manager' }, cards: [], today: '2026-11-26', postingToday: 0, connectedClientIds: new Set(), clientCount: 9, leadsWeek: 0, mayLeads: false } as never)
    const tile = tiles.find(t => t.key === 'clients')
    expect(tile).toMatchObject({ title: 'Your clients', href: '/dashboard/clients?mine=1' })
    expect(tile?.stats[0]).toMatchObject({ value: 9 })
  })
})
