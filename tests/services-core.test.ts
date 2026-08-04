import { describe, it, expect } from 'vitest'
import {
  normaliseService, collectServices, addService, removeService,
  suggestServices, hasService,
} from '../app/lib/services-core'

describe('normaliseService', () => {
  it('trims and collapses whitespace, keeping the display casing', () => {
    expect(normaliseService('  Content   Production ')).toBe('Content Production')
    expect(normaliseService('Paid Ads')).toBe('Paid Ads')
  })
})

describe('collectServices', () => {
  const projects = [
    { services: ['Content Production', 'Brand Strategy'] },
    { services: ['Content Production', 'Paid Ads'] },
    { services: ['content production'] },      // same tag, different casing
    { services: [] },
    { services: ['  Brand Strategy  '] },      // same tag, stray whitespace
  ]

  it('counts case- and whitespace-insensitively, most used first', () => {
    expect(collectServices(projects)).toEqual([
      'Content Production',  // 3
      'Brand Strategy',      // 2
      'Paid Ads',            // 1
    ])
  })

  it('keeps the first spelling seen rather than the lowercased one', () => {
    expect(collectServices([{ services: ['Paid Ads'] }, { services: ['paid ads'] }]))
      .toEqual(['Paid Ads'])
  })

  it('breaks ties alphabetically so the order is stable', () => {
    expect(collectServices([{ services: ['Zeta', 'Alpha'] }])).toEqual(['Alpha', 'Zeta'])
  })

  it('does not count a tag twice for one project', () => {
    // otherwise a duplicated tag would outrank genuinely popular ones
    expect(collectServices([
      { services: ['Content', 'content', 'CONTENT'] },
      { services: ['Paid'] },
      { services: ['Paid'] },
    ])).toEqual(['Paid', 'Content'])
  })

  it('ignores empty and whitespace-only entries', () => {
    expect(collectServices([{ services: ['', '   ', 'Real'] }])).toEqual(['Real'])
  })
})

describe('addService', () => {
  it('appends a new tag', () => {
    expect(addService(['A'], 'B')).toEqual(['A', 'B'])
  })

  it('refuses duplicates whatever the casing or spacing', () => {
    expect(addService(['Paid Ads'], 'paid ads')).toEqual(['Paid Ads'])
    expect(addService(['Paid Ads'], '  Paid   Ads ')).toEqual(['Paid Ads'])
  })

  it('ignores empty input', () => {
    expect(addService(['A'], '   ')).toEqual(['A'])
  })
})

describe('removeService', () => {
  it('removes case-insensitively', () => {
    expect(removeService(['Paid Ads', 'Content'], 'PAID ADS')).toEqual(['Content'])
  })
})

describe('suggestServices', () => {
  it('offers only what is not already chosen', () => {
    expect(suggestServices(['A', 'B', 'C'], ['b'])).toEqual(['A', 'C'])
  })
})

describe('hasService', () => {
  it('matches case-insensitively', () => {
    expect(hasService(['Content Production'], 'content production')).toBe(true)
    expect(hasService(['Content Production'], 'Paid Ads')).toBe(false)
  })
})
