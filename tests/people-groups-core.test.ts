import { describe, expect, it } from 'vitest'
import { groupPeople, personWords } from '../app/lib/people-groups-core'

const T = [
  { id: 'a', name: 'Akmal', role: 'super_admin' },
  { id: 'b', name: 'akmaltestmdmedia@gmail.com', role: 'editor', email: 'akmaltestmdmedia@gmail.com' },
  { id: 'c', name: 'Karly', role: 'account_manager' },
  { id: 'd', name: 'Joy', role: 'quality_checker' },
  { id: 'e', name: 'Cath', role: 'scheduler' },
  { id: 'f', name: 'Zed', role: 'editor' },
  { id: 'g', name: 'Client Person', role: 'client' },
  { id: 'h', name: 'Vik', role: 'general' },
]

describe('people pickers grouped by role (13 Sep 2026)', () => {
  it('groups under headers in one order, editors first when asked, sorted by name, clients never', () => {
    const g = groupPeople(T, 'editor')
    expect(g.map(x => x.label)).toEqual(['Editors', 'Account managers', 'Super admins', 'Schedulers', 'Quality checkers', 'Team'])
    expect(g[0].people.map(p => p.id)).toEqual(['b', 'f'])
    expect(g.flatMap(x => x.people).some(p => p.id === 'g')).toBe(false)
  })
  it('a crew picker leads with the whole team, and empty groups are left out', () => {
    const g = groupPeople(T.filter(p => p.role !== 'scheduler'), 'general')
    expect(g[0].label).toBe('Team')
    expect(g.map(x => x.label)).not.toContain('Schedulers')
  })
  it('never lists a bare email address as a name', () => {
    expect(personWords({ name: 'akmaltestmdmedia@gmail.com', email: 'akmaltestmdmedia@gmail.com' })).toBe('Akmaltestmdmedia')
    expect(personWords({ name: 'Karly' })).toBe('Karly')
  })
})
