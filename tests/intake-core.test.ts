import { describe, it, expect } from 'vitest'
import { answerableBlocks, mergeAnswers, type TemplateDefinition } from '../app/lib/intake-core'

const DEF: TemplateDefinition = {
  key: 'rebrand',
  name: 'Rebrand intake',
  sections: [
    {
      id: 'brand', title: 'Brand snapshot',
      blocks: [
        { id: 'g1', type: 'guidance', label: 'Tell us who you are.' },
        { id: 'venue_name', type: 'short_text', label: 'Venue name' },
        { id: 'website', type: 'link', label: 'Website URL' },
      ],
    },
    {
      id: 'voice', title: 'Brand and voice',
      blocks: [
        { id: 'tone', type: 'select', label: 'Tone of voice', options: ['Warm', 'Premium', 'Both'] },
        { id: 'never', type: 'long_text', label: 'Three words it should never feel' },
      ],
    },
  ],
}

describe('answerableBlocks', () => {
  it('excludes guidance blocks — they are copy, not questions', () => {
    expect(answerableBlocks(DEF).map(b => b.id))
      .toEqual(['venue_name', 'website', 'tone', 'never'])
  })
})

describe('mergeAnswers', () => {
  it('merges a patch over existing answers without touching the rest', () => {
    const merged = mergeAnswers(DEF, { venue_name: 'The Emerald', tone: 'Both' }, { tone: 'Warm' })
    expect(merged).toEqual({ venue_name: 'The Emerald', tone: 'Warm' })
  })

  it('ignores keys that are not blocks in this template', () => {
    const merged = mergeAnswers(DEF, { venue_name: 'The Emerald' }, { evil: 'x', website: 'a.com' })
    expect(merged).toEqual({ venue_name: 'The Emerald', website: 'a.com' })
  })

  it('ignores guidance ids — copy can never hold an answer', () => {
    expect(mergeAnswers(DEF, {}, { g1: 'nope' })).toEqual({})
  })

  it('keeps an array answer for a multi-select and coerces other values to string', () => {
    const def: TemplateDefinition = {
      key: 'launch', name: 'x',
      sections: [{ id: 's', title: 's', blocks: [
        { id: 'pillars', type: 'multi_select', label: 'Pillars', options: ['a', 'b'] },
        { id: 'year', type: 'short_text', label: 'Year' },
      ] }],
    }
    expect(mergeAnswers(def, {}, { pillars: ['a', 'b'], year: 1985 as unknown as string }))
      .toEqual({ pillars: ['a', 'b'], year: '1985' })
  })

  it('an empty string clears an answer rather than storing blank', () => {
    expect(mergeAnswers(DEF, { venue_name: 'The Emerald' }, { venue_name: '' })).toEqual({})
  })

  it('survives junk in place of a patch object', () => {
    expect(mergeAnswers(DEF, { venue_name: 'The Emerald' }, null)).toEqual({ venue_name: 'The Emerald' })
    expect(mergeAnswers(DEF, { venue_name: 'The Emerald' }, 'nope')).toEqual({ venue_name: 'The Emerald' })
  })
})
