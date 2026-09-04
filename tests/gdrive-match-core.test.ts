import { describe, it, expect } from 'vitest'
import {
  LIKELY_OVERLAP, matchClientFolders, nameOverlap, normaliseFolderName,
} from '../app/lib/gdrive-core'

/**
 * Lining the client list up against folders that were made by hand, years
 * before this app existed.
 *
 * The names in here are the real shape of the problem: an apostrophe, an
 * ampersand, a company suffix somebody typed on one side and not the other,
 * and a name that starts with a number.
 */

describe('normaliseFolderName', () => {
  it('ignores capitals, punctuation and spacing', () => {
    expect(normaliseFolderName('  Alia   Fragrance ')).toBe('alia fragrance')
    expect(normaliseFolderName('Alia-Fragrance')).toBe('alia fragrance')
  })

  it('closes up an apostrophe rather than splitting the word', () => {
    expect(normaliseFolderName("Cecconi's Toorak")).toBe('cecconis toorak')
    expect(normaliseFolderName('Cecconi’s Toorak')).toBe('cecconis toorak')
  })

  it('reads & as "and", because both spellings are the same client', () => {
    expect(normaliseFolderName("Cecconi's Toorak & Flinders"))
      .toBe(normaliseFolderName('Cecconis Toorak and Flinders'))
  })

  it('drops a trailing company suffix, however it was typed', () => {
    expect(normaliseFolderName('Alia Fragrance Pty Ltd')).toBe('alia fragrance')
    expect(normaliseFolderName('Alia Fragrance Pty. Ltd.')).toBe('alia fragrance')
    expect(normaliseFolderName('Alia Fragrance Ltd')).toBe('alia fragrance')
    expect(normaliseFolderName('Alia Fragrance Inc')).toBe('alia fragrance')
  })

  it('keeps a suffix word that is part of the name, not on the end', () => {
    expect(normaliseFolderName('Ltd Edition Studio')).toBe('ltd edition studio')
    // "Incline" is not "Inc"
    expect(normaliseFolderName('Incline Homes')).toBe('incline homes')
  })

  it('never strips a name away to nothing', () => {
    expect(normaliseFolderName('Co')).toBe('co')
    expect(normaliseFolderName('')).toBe('')
  })

  it('keeps digits, which carry the name here', () => {
    expect(normaliseFolderName('100 Hundred Million Group')).toBe('100 hundred million group')
  })
})

describe('nameOverlap', () => {
  it('is 1 for the same client typed two ways', () => {
    expect(nameOverlap('Alia Fragrance Pty Ltd', 'alia fragrance')).toBe(1)
  })

  it('counts shared words over the LONGER name', () => {
    // one word of three: nowhere near close enough to act on
    expect(nameOverlap('Alia', 'Alia Fragrance Skincare')).toBeCloseTo(1 / 3)
    expect(nameOverlap('Alia', 'Alia Fragrance Skincare')).toBeLessThan(LIKELY_OVERLAP)
  })

  it('is 0 when there is nothing to compare', () => {
    expect(nameOverlap('', 'Anything')).toBe(0)
  })
})

const clients = [
  { id: 'c1', name: "Cecconi's Toorak & Flinders" },
  { id: 'c2', name: '100 Hundred Million Group' },
  { id: 'c3', name: 'Alia Fragrance Pty Ltd' },
  { id: 'c4', name: 'Brand New Client' },
]

describe('matchClientFolders', () => {
  it('matches on the tidied name and says it was exact', () => {
    const plan = matchClientFolders(clients, [
      { id: 'f1', name: 'Cecconis Toorak and Flinders' },
      { id: 'f2', name: '100 Hundred Million Group' },
      { id: 'f3', name: 'Alia Fragrance' },
    ])
    expect(plan.matched.map(m => [m.client.id, m.folder.id, m.confidence])).toEqual([
      ['c1', 'f1', 'exact'],
      ['c2', 'f2', 'exact'],
      ['c3', 'f3', 'exact'],
    ])
    expect(plan.unmatched.map(c => c.id)).toEqual(['c4'])
    expect(plan.extra).toEqual([])
  })

  it('leaves a client with no folder to be created, and says which folders are spare', () => {
    const plan = matchClientFolders(
      [{ id: 'c4', name: 'Brand New Client' }],
      [{ id: 'f9', name: 'Old Archive' }],
    )
    expect(plan.matched).toEqual([])
    expect(plan.unmatched.map(c => c.id)).toEqual(['c4'])
    expect(plan.extra.map(f => f.id)).toEqual(['f9'])
  })

  it('flags a close-but-not-exact folder as likely rather than assuming', () => {
    const plan = matchClientFolders(
      [{ id: 'c1', name: 'Hundred Million Group Melbourne' }],
      [{ id: 'f1', name: 'Hundred Million Group Melb' }],
    )
    // three words of four shared is BELOW the bar — nothing is claimed
    expect(plan.matched).toEqual([])
    expect(plan.unmatched.map(c => c.id)).toEqual(['c1'])

    const closer = matchClientFolders(
      [{ id: 'c1', name: 'Alia Fragrance Skincare Melbourne' }],
      [{ id: 'f1', name: 'Alia Fragrance Skincare Melbourne Studio' }],
    )
    expect(closer.matched.map(m => [m.folder.id, m.confidence])).toEqual([['f1', 'likely']])
  })

  it('hands an ambiguity back rather than tossing a coin', () => {
    const plan = matchClientFolders(
      [{ id: 'c1', name: 'Alia Fragrance Skincare Melbourne' }],
      [
        { id: 'f1', name: 'Alia Fragrance Skincare Melbourne North' },
        { id: 'f2', name: 'Alia Fragrance Skincare Melbourne South' },
      ],
    )
    expect(plan.matched).toEqual([])
    expect(plan.unmatched.map(c => c.id)).toEqual(['c1'])
    expect(plan.extra.map(f => f.id)).toEqual(['f1', 'f2'])
  })

  it('never gives two clients the same folder', () => {
    const plan = matchClientFolders(
      [{ id: 'c1', name: 'Acme' }, { id: 'c2', name: 'Acme Pty Ltd' }],
      [{ id: 'f1', name: 'Acme' }],
    )
    expect(plan.matched.map(m => m.client.id)).toEqual(['c1'])
    expect(plan.unmatched.map(c => c.id)).toEqual(['c2'])
  })

  it('leaves a duplicate folder spare instead of sharing it', () => {
    const plan = matchClientFolders(
      [{ id: 'c1', name: 'Acme' }],
      [{ id: 'f1', name: 'Acme' }, { id: 'f2', name: 'ACME' }],
    )
    expect(plan.matched.map(m => m.folder.id)).toEqual(['f1'])
    expect(plan.extra.map(f => f.id)).toEqual(['f2'])
  })

  it('is pure — the same lists in, the same plan out', () => {
    const folders = [{ id: 'f1', name: 'Alia Fragrance' }]
    const a = matchClientFolders(clients, folders)
    const b = matchClientFolders(clients, folders)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
