import { describe, expect, it } from 'vitest'
import {
  applyFilters, cardInvolves, clientsOnCards, filterWords, filteredEmpty, hasFilters, initialsOf,
  mayFilterPeople, peopleOnCard, peopleOnCards, validChoice, NO_FILTERS,
} from '../app/lib/people-filter-core'

/* ── who is doing what: the Client and People filters (11 Sep 2026) ── */

const who = new Map([
  ['ada', { name: 'Ada Lovelace', role: 'editor' }],
  ['cath', { name: 'Cath', role: 'scheduler' }],
  ['joy', { name: 'Joy', role: 'account_manager' }],
])
const cards = [
  { id: 'c1', client_id: 'acme', owner_id: 'ada' },
  { id: 'c2', client_id: 'acme', owner_id: 'ada', scheduler_ids: ['cath'], asked_ids: ['joy'] },
  { id: 'c3', client_id: 'bond', owner_id: null, scheduler_ids: ['cath'] },
  { id: 's1', client_id: 'bond', owner_id: 'joy', editor_id: 'ada', crew_ids: ['cath', 'ghost'] },
]

describe('who may narrow to a person', () => {
  it('is the people whose job is to look across everyone', () => {
    expect(mayFilterPeople({ role: 'super_admin' })).toBe(true)
    expect(mayFilterPeople({ role: 'account_manager' })).toBe(true)
    expect(mayFilterPeople({ role: 'scheduler', quality_reviewer: true })).toBe(true)
    expect(mayFilterPeople({ role: 'editor' })).toBe(false)
    expect(mayFilterPeople({ role: 'general' })).toBe(false)
    expect(mayFilterPeople({ role: 'scheduler' })).toBe(false)
  })
})

describe('a card involves', () => {
  it('its owner, its schedulers, whoever was asked, and a shoot\u2019s editor and crew — once each', () => {
    expect(peopleOnCard(cards[1])).toEqual(['ada', 'cath', 'joy'])
    expect(peopleOnCard(cards[3])).toEqual(['joy', 'ada', 'cath', 'ghost'])
    expect(peopleOnCard({ id: 'x', owner_id: 'ada', editor_id: 'ada', crew_ids: ['ada'] })).toEqual(['ada'])
    expect(cardInvolves(cards[2], 'cath')).toBe(true)
    expect(cardInvolves(cards[2], 'ada')).toBe(false)
  })
})

describe('the pickers', () => {
  it('list the people on the cards, busiest first, with a role word and a count', () => {
    const rows = peopleOnCards(cards, who)
    expect(rows.map(r => [r.id, r.count])).toEqual([['ada', 3], ['cath', 3], ['joy', 2], ['ghost', 1]])
    expect(rows[0]).toMatchObject({ name: 'Ada Lovelace', role: 'editor', initials: 'AL' })
    // somebody on a card but not on the team list is still counted, as Someone
    expect(rows[3]).toMatchObject({ name: 'Someone', role: '', initials: 'SO' })
  })
  it('list the clients on the cards by name with a count', () => {
    const rows = clientsOnCards(cards, new Map([['acme', 'Acme'], ['bond', 'Bond Street']]))
    expect(rows).toEqual([{ id: 'acme', name: 'Acme', count: 2 }, { id: 'bond', name: 'Bond Street', count: 2 }])
  })
  it('turn a remembered id that is not on offer into nobody', () => {
    const rows = peopleOnCards(cards, who)
    expect(validChoice('ada', rows)).toBe('ada')
    expect(validChoice('left-the-team', rows)).toBeNull()
    expect(validChoice(null, rows)).toBeNull()
  })
  it('makes initials from two names, or the first two letters', () => {
    expect(initialsOf('Ada Lovelace')).toBe('AL')
    expect(initialsOf('cath')).toBe('CA')
    expect(initialsOf('')).toBe('—')
  })
})

describe('narrowing', () => {
  it('applies client and person together, and nothing when nothing is chosen', () => {
    expect(applyFilters(cards, NO_FILTERS)).toHaveLength(4)
    expect(applyFilters(cards, { client: 'acme', person: null }).map(c => c.id)).toEqual(['c1', 'c2'])
    expect(applyFilters(cards, { client: null, person: 'cath' }).map(c => c.id)).toEqual(['c2', 'c3', 's1'])
    expect(applyFilters(cards, { client: 'bond', person: 'cath' }).map(c => c.id)).toEqual(['c3', 's1'])
    expect(hasFilters(NO_FILTERS)).toBe(false)
    expect(hasFilters({ client: 'acme', person: null })).toBe(true)
  })
  it('narrows to cards with a finished edit or without, and to a version — the Editor page’s work filters (16 Sep 2026)', async () => {
    const { cardHasFiles, cardOnVersion, filesChoice, versionChoice } = await import('../app/lib/people-filter-core')
    const done = { id: 'w1', client_id: 'acme', link_url: 'https://drive.google.com/drive/folders/A', link_final: true, edit_round: 2 }
    const folderOnly = { id: 'w2', client_id: 'acme', link_url: 'https://drive.google.com/drive/folders/B', raw_assets_url: 'https://drive.google.com/drive/folders/B' }
    const nothing = { id: 'w3', client_id: 'acme', edit_round: 3 }
    expect(cardHasFiles(done)).toBe(true)
    expect(cardHasFiles(folderOnly)).toBe(false)
    expect(cardHasFiles(nothing)).toBe(false)
    expect(applyFilters([done, folderOnly, nothing], { client: null, person: null, files: 'with' }).map(c => c.id)).toEqual(['w1'])
    expect(applyFilters([done, folderOnly, nothing], { client: null, person: null, files: 'without' }).map(c => c.id)).toEqual(['w2', 'w3'])
    expect(applyFilters([done, folderOnly, nothing], { client: null, person: null, version: '1' }).map(c => c.id)).toEqual(['w2'])
    expect(applyFilters([done, folderOnly, nothing], { client: null, person: null, version: '2' }).map(c => c.id)).toEqual(['w1'])
    expect(applyFilters([done, folderOnly, nothing], { client: null, person: null, version: '3+' }).map(c => c.id)).toEqual(['w3'])
    expect(cardOnVersion({ id: 'x', edit_round: 7 }, '3+')).toBe(true)
    expect(hasFilters({ client: null, person: null, files: 'with' })).toBe(true)
    expect(filesChoice('with')).toBe('with'); expect(filesChoice('nope')).toBeNull()
    expect(versionChoice('3+')).toBe('3+'); expect(versionChoice('9')).toBeNull()
    expect(filterWords({ client: null, person: null, files: 'with', version: '2' }, {}, 1, 3)).toBe('Showing every card with a finished edit on version 2 — 1 of 3')
    expect(filteredEmpty('Quality check', { client: null, person: null, files: 'without' }, {})).toBe('No cards with nothing handed in in Quality check')
  })
  it('says what is shown, and why a column is empty, in plain words', () => {
    expect(filterWords(NO_FILTERS, {}, 4, 4)).toBeNull()
    expect(filterWords({ client: null, person: 'ada' }, { person: 'Ada Lovelace' }, 3, 4))
      .toBe('Showing Ada Lovelace\u2019s cards — 3 of 4')
    expect(filterWords({ client: 'acme', person: 'ada' }, { person: 'Ada Lovelace', client: 'Acme' }, 2, 4))
      .toBe('Showing Ada Lovelace\u2019s cards for Acme — 2 of 4')
    expect(filterWords({ client: 'acme', person: null }, { client: 'Acme' }, 2, 4))
      .toBe('Showing every card for Acme — 2 of 4')
    expect(filteredEmpty('With client', NO_FILTERS, {})).toBeNull()
    expect(filteredEmpty('With client', { client: null, person: 'ada' }, { person: 'Ada' })).toBe('No cards for Ada in With client')
    expect(filteredEmpty('Draft', { client: 'acme', person: 'ada' }, { person: 'Ada', client: 'Acme' })).toBe('No cards for Ada at Acme in Draft')
  })
})
