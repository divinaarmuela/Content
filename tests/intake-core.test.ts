import { describe, it, expect } from 'vitest'
import {
  answerableBlocks, mergeAnswers, completion, isWritable, nextStatus,
  type TemplateDefinition,
} from '../app/lib/intake-core'

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

describe('completion', () => {
  it('counts answered blocks overall and per section, ignoring guidance', () => {
    const c = completion(DEF, { venue_name: 'The Emerald', tone: 'Both' })
    expect(c.answered).toBe(2)
    expect(c.total).toBe(4)
    expect(c.sections).toEqual([
      { id: 'brand', title: 'Brand snapshot', answered: 1, total: 2 },
      { id: 'voice', title: 'Brand and voice', answered: 1, total: 2 },
    ])
  })

  it('counts an empty array as unanswered', () => {
    const def: TemplateDefinition = {
      key: 'launch', name: 'x',
      sections: [{ id: 's', title: 's', blocks: [
        { id: 'files', type: 'file', label: 'Logo files' },
      ] }],
    }
    expect(completion(def, { files: [] }).answered).toBe(0)
    expect(completion(def, { files: ['a.png'] }).answered).toBe(1)
  })
})

describe('isWritable', () => {
  it('allows writes until submitted', () => {
    expect(isWritable('draft')).toBe(true)
    expect(isWritable('sent')).toBe(true)
    expect(isWritable('in_progress')).toBe(true)
  })

  it('refuses writes once submitted — a forwarded link cannot rewrite history', () => {
    expect(isWritable('submitted')).toBe(false)
  })
})

describe('nextStatus', () => {
  it('marks in_progress on the first save, not on opening the link', () => {
    expect(nextStatus('sent', 'open')).toBe('sent')
    expect(nextStatus('sent', 'save')).toBe('in_progress')
  })

  it('does not move backwards once in progress', () => {
    expect(nextStatus('in_progress', 'save')).toBe('in_progress')
    expect(nextStatus('in_progress', 'open')).toBe('in_progress')
  })

  it('submits from any writable state', () => {
    expect(nextStatus('sent', 'submit')).toBe('submitted')
    expect(nextStatus('in_progress', 'submit')).toBe('submitted')
  })

  it('reopening returns to in_progress so the client can carry on', () => {
    expect(nextStatus('submitted', 'reopen')).toBe('in_progress')
  })

  it('a save against a submitted form changes nothing', () => {
    expect(nextStatus('submitted', 'save')).toBe('submitted')
  })
})
