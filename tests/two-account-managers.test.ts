import { describe, expect, it } from 'vitest'
import { amClause, amPhrase, changesSentToast, joinManagers, managersWord } from '../app/lib/portal-words'
import { canManageShoot, canSeeShoot, reviewersFor, type SopShoot } from '../app/lib/shoot-sop-core'
import { defaultOnboarding } from '../app/lib/onboarding-email-core'

/**
 * MORE THAN ONE ACCOUNT MANAGER ON A CLIENT (the owner, 20 Nov 2026: "shoot owner keep one but they can still manage
 * it and make edits. client facing can show both"). A client's managers were always a list in the database; these pin
 * the three things that follow from it, so a second manager is never quietly treated as nobody.
 */

describe('the client is told every account manager, not one of them', () => {
  it('names one, two or three by first name', () => {
    expect(joinManagers(['Karly Smith'])).toBe('Karly')
    expect(joinManagers(['Karly Smith', 'Manal A'])).toBe('Karly or Manal')
    expect(joinManagers(['Karly', 'Manal', 'Joy'])).toBe('Karly, Manal or Joy')
  })
  it('skips a blank name and never says the same name twice', () => {
    expect(joinManagers(['Karly', null, '  ', 'karly jones'])).toBe('Karly')
    expect(joinManagers([])).toBeNull()
    expect(joinManagers([null, ''])).toBeNull()
  })
  it('the words around the name agree with how many there are', () => {
    expect(amPhrase('Karly')).toBe('Karly, your account manager')
    expect(amPhrase('Karly or Manal')).toBe('Karly or Manal, your account managers')
    expect(amClause('Karly or Manal')).toBe('Karly or Manal, your account managers,')
    expect(changesSentToast('Karly or Manal')).toBe('Sent to Karly or Manal, your account managers.')
    expect(amPhrase(null)).toBe('your account manager')
    expect(managersWord('Karly')).toBe('your account manager')
    // a name with "or" inside a word is still one person
    expect(managersWord('Victor')).toBe('your account manager')
  })
  it('the welcome email names both, under a heading that says so', () => {
    const base = { clientName: 'Acme', contactName: 'Jo', services: [], startDate: null }
    const two = defaultOnboarding({ ...base, managerName: 'Sam Manager and Jo Lead' } as never)
    expect(two.agreed.find(r => r.label === 'Your account managers')?.value).toContain('Sam Manager and Jo Lead')
    const one = defaultOnboarding({ ...base, managerName: 'Sam Manager' } as never)
    expect(one.agreed.some(r => r.label === 'Your account manager')).toBe(true)
  })
})

describe('a shoot has one owner, and every account manager on the client can open and manage it', () => {
  const shoot = { client_id: 'c1', owner_id: 'karly', created_by: 'karly' } as unknown as SopShoot
  const second = { id: 'manal', role: 'account_manager' as const, clientIds: ['c1'] }
  const outsider = { id: 'joy', role: 'account_manager' as const, clientIds: ['c2'] }

  it('the second account manager manages a shoot they neither own nor created', () => {
    expect(canManageShoot(second, shoot)).toBe(true)
    expect(canManageShoot({ id: 'karly', role: 'account_manager', clientIds: ['c1'] }, shoot)).toBe(true)
  })
  it('and sees it', () => {
    expect(canSeeShoot({ id: 'manal', role: 'account_manager' }, shoot, ['c1'])).toBe(true)
  })
  it('an account manager who is not on the client does neither', () => {
    expect(canManageShoot(outsider, shoot)).toBe(false)
    expect(canSeeShoot({ id: 'joy', role: 'account_manager' }, { ...shoot, crew_ids: [], editor_id: null } as unknown as SopShoot, ['c2'])).toBe(false)
  })
  it('a review is asked of every account manager on the client, never the one asking', () => {
    const managers = [
      { id: 'karly', role: 'account_manager', active_status: true },
      { id: 'manal', role: 'account_manager', active_status: true },
      { id: 'gone', role: 'account_manager', active_status: false },
    ]
    expect(reviewersFor('karly', null, managers)).toEqual(['manal'])
    expect(reviewersFor('someone-else', null, managers)).toEqual(['karly', 'manal'])
  })
})
