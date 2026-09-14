import { describe, expect, it } from 'vitest'
import { cardPeople } from '../app/lib/card-people-core'
import { roleLabel } from '../app/lib/identity-core'

/**
 * WHO "@" OFFERS ON A CARD (the owner, 14 Sep 2026: "if I click @ it will
 * show email options available for tagging within that card, like super
 * admin, the AM and quality review").
 */
const TEAM = [
  { id: 'am-1', name: 'Priya Patel', email: 'priya@x.invalid', role: 'account_manager', active_status: true },
  { id: 'am-2', name: 'Other Manager', email: 'other@x.invalid', role: 'account_manager', active_status: true },
  { id: 'qc', name: 'Joy Quality', email: 'joy@x.invalid', role: 'quality_checker', active_status: true },
  { id: 'am-flag', name: 'Flagged Manager', email: 'flag@x.invalid', role: 'account_manager', active_status: true, quality_reviewer: true },
  { id: 'sa', name: 'Akmal Ashwin', email: 'akmal@x.invalid', role: 'super_admin', active_status: true },
  { id: 'ed', name: 'Sam Editor', email: 'sam@x.invalid', role: 'editor', active_status: true },
  { id: 'ed-2', name: 'Another Editor', email: 'ed2@x.invalid', role: 'editor', active_status: true },
  { id: 'sc', name: 'Cath Scheduler', email: 'cath@x.invalid', role: 'scheduler', active_status: true },
  { id: 'gone', name: 'Left Us', email: 'gone@x.invalid', role: 'super_admin', active_status: false },
  { id: 'cl', name: 'The Client', email: 'client@x.invalid', role: 'client', active_status: true },
]
const LINKS = [
  { team_user_id: 'am-1', client_id: 'c-1' },
  { team_user_id: 'am-2', client_id: 'c-other' },
]

describe('cardPeople', () => {
  it('offers the client’s managers, the quality checkers, the super admins, the holder and the schedulers — each once, with email and job', () => {
    const people = cardPeople({ client_id: 'c-1', owner_id: 'ed', scheduler_ids: ['sc'] }, TEAM, LINKS)
    expect(people.map(p => p.id)).toEqual(['am-1', 'qc', 'am-flag', 'sa', 'ed', 'sc'])
    expect(people[0]).toEqual({ id: 'am-1', name: 'Priya Patel', email: 'priya@x.invalid', hint: `${roleLabel('account_manager')} · this client` })
    expect(people.find(p => p.id === 'qc')?.hint).toBe(roleLabel('quality_checker'))
    expect(people.find(p => p.id === 'am-flag')?.hint).toBe(`${roleLabel('account_manager')} · quality checker`)
    expect(people.find(p => p.id === 'sa')?.hint).toBe(roleLabel('super_admin'))
    expect(people.find(p => p.id === 'ed')?.hint).toBe(`${roleLabel('editor')} · has the card`)
    expect(people.find(p => p.id === 'sc')?.hint).toBe(`${roleLabel('scheduler')} · scheduling it`)
    for (const p of people) expect(p.email).toContain('@')
  })
  it('never offers another client’s manager, an editor not on the card, someone inactive, a client, or the writer', () => {
    const ids = cardPeople({ client_id: 'c-1', owner_id: 'ed' }, TEAM, LINKS, 'sa').map(p => p.id)
    expect(ids).not.toContain('am-2')
    expect(ids).not.toContain('ed-2')
    expect(ids).not.toContain('gone')
    expect(ids).not.toContain('cl')
    expect(ids).not.toContain('sa')
    expect(ids).toContain('ed')
  })
  it('a card with nobody on it still offers the checkers and the super admins', () => {
    const ids = cardPeople({ client_id: 'c-none' }, TEAM, LINKS).map(p => p.id)
    expect(ids).toEqual(['qc', 'am-flag', 'sa'])
  })
})
