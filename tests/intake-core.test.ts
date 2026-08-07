import { describe, it, expect } from 'vitest'
import {
  answerableBlocks, mergeAnswers, completion, isWritable, nextStatus,
  normaliseDefinition, moveItem, slugify, normaliseRecipients, resolveRecipients,
  type TemplateDefinition,
} from '../app/lib/intake-core'
import { TEMPLATES, templateFor } from '../app/lib/intake-templates'

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

describe('slugify', () => {
  it('turns a label into a stable id', () => {
    expect(slugify('Venue name, as it appears publicly', 'x')).toBe('venue_name_as_it_appears_publicly')
  })

  it('falls back when a label has nothing usable in it', () => {
    expect(slugify('—  ??', 'q_1_2')).toBe('q_1_2')
    expect(slugify('', 'q_0_0')).toBe('q_0_0')
  })
})

describe('moveItem', () => {
  it('moves an item and closes the gap', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op at the ends rather than an error', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 0, -1)).toBe(list)
    expect(moveItem(list, 2, 3)).toBe(list)
    expect(moveItem(list, 1, 1)).toBe(list)
  })

  it('does not mutate the original', () => {
    const list = ['a', 'b', 'c']
    moveItem(list, 0, 2)
    expect(list).toEqual(['a', 'b', 'c'])
  })
})

describe('normaliseDefinition', () => {
  it('keeps existing block ids so answers are never orphaned', () => {
    const def = normaliseDefinition({
      name: 'Custom', sections: [{ id: 'brand', title: 'Brand', blocks: [
        { id: 'venue_name', type: 'short_text', label: 'Venue name (renamed)' },
      ] }],
    }, 'rebrand')
    expect(def.sections[0].blocks[0].id).toBe('venue_name')
    expect(def.sections[0].blocks[0].label).toBe('Venue name (renamed)')
  })

  it('derives an id from the label for a new block', () => {
    const def = normaliseDefinition({
      sections: [{ title: 'S', blocks: [{ type: 'long_text', label: 'What is your story?' }] }],
    }, 'rebrand')
    expect(def.sections[0].blocks[0].id).toBe('what_is_your_story')
  })

  it('de-duplicates ids — two questions sharing one would merge their answers', () => {
    const def = normaliseDefinition({
      sections: [{ title: 'S', blocks: [
        { id: 'tone', type: 'short_text', label: 'Tone' },
        { id: 'tone', type: 'short_text', label: 'Tone again' },
      ] }],
    }, 'rebrand')
    const [a, b] = def.sections[0].blocks
    expect(a.id).not.toBe(b.id)
  })

  it('repairs an unknown block type rather than rendering nothing', () => {
    const def = normaliseDefinition({
      sections: [{ title: 'S', blocks: [{ id: 'x', type: 'wysiwyg', label: 'X' }] }],
    }, 'rebrand')
    expect(def.sections[0].blocks[0].type).toBe('short_text')
  })

  it('gives an empty label something answerable', () => {
    const def = normaliseDefinition({
      sections: [{ title: '', blocks: [{ id: 'x', type: 'short_text', label: '   ' }] }],
    }, 'rebrand')
    expect(def.sections[0].title).toBe('Section 1')
    expect(def.sections[0].blocks[0].label).toBe('Question 1')
  })

  it('drops options from types that cannot use them', () => {
    const def = normaliseDefinition({
      sections: [{ title: 'S', blocks: [
        { id: 'a', type: 'short_text', label: 'A', options: ['x', 'y'] },
        { id: 'b', type: 'select', label: 'B', options: ['x', '', ' y '] },
      ] }],
    }, 'rebrand')
    expect(def.sections[0].blocks[0].options).toBeUndefined()
    expect(def.sections[0].blocks[1].options).toEqual(['x', 'y'])
  })

  it('survives junk entirely', () => {
    expect(normaliseDefinition(null, 'rebrand').sections).toEqual([])
    expect(normaliseDefinition({ sections: 'nope' }, 'rebrand').sections).toEqual([])
    expect(normaliseDefinition({ sections: [null] }, 'rebrand').sections[0].blocks).toEqual([])
  })

  it('falls back to a known template key', () => {
    expect(normaliseDefinition({}, 'made_up' as never).key).toBe('one_off')
  })

  it('round-trips a real template unchanged', () => {
    const before = TEMPLATES.rebrand
    const after = normaliseDefinition(JSON.parse(JSON.stringify(before)), 'rebrand')
    expect(after).toEqual(before)
  })
})

describe('templates', () => {
  it('defines every engagement type', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(['launch', 'one_off', 'ongoing', 'rebrand'])
  })

  it('asks the ongoing client about the founders and paid ads, the one-off client neither', () => {
    const ongoing = answerableBlocks(TEMPLATES.ongoing).map(b => b.id)
    expect(ongoing).toContain('founder_stories')
    expect(ongoing).toContain('quality_lead')
    const oneOff = answerableBlocks(TEMPLATES.one_off).map(b => b.id)
    expect(oneOff).not.toContain('founder_stories')
  })

  it('gives every block a unique id within its template', () => {
    for (const def of Object.values(TEMPLATES)) {
      const ids = def.sections.flatMap(s => s.blocks).map(b => b.id)
      expect(new Set(ids).size, `duplicate block id in ${def.key}`).toBe(ids.length)
    }
  })

  it('gives every section a unique id within its template', () => {
    for (const def of Object.values(TEMPLATES)) {
      const ids = def.sections.map(s => s.id)
      expect(new Set(ids).size, `duplicate section id in ${def.key}`).toBe(ids.length)
    }
  })

  it('gives every select and multi_select at least two options', () => {
    for (const def of Object.values(TEMPLATES)) {
      for (const b of answerableBlocks(def)) {
        if (b.type === 'select' || b.type === 'multi_select') {
          expect((b.options ?? []).length, `${def.key}/${b.id}`).toBeGreaterThan(1)
        }
      }
    }
  })

  it('asks the rebrand client about heritage, and the one-off client not at all', () => {
    expect(answerableBlocks(TEMPLATES.rebrand).map(b => b.id)).toContain('history')
    expect(answerableBlocks(TEMPLATES.one_off).map(b => b.id)).not.toContain('history')
  })

  it('captures the approval contact in every template — production needs it', () => {
    for (const def of Object.values(TEMPLATES)) {
      expect(answerableBlocks(def).map(b => b.id), def.key).toContain('approval_contact')
    }
  })

  it('opens every template with guidance rather than a bare question', () => {
    for (const def of Object.values(TEMPLATES)) {
      expect(def.sections[0].blocks[0].type, def.key).toBe('guidance')
    }
  })

  it('falls back to one_off for an unknown key rather than throwing', () => {
    expect(templateFor('nonsense' as never).key).toBe('one_off')
  })
})

describe('normaliseRecipients', () => {
  it('lowercases, trims and de-duplicates', () => {
    expect(normaliseRecipients([' Akmal@MDM.com ', 'akmal@mdm.com']))
      .toEqual(['akmal@mdm.com'])
  })

  it('drops anything that is not a plausible address', () => {
    expect(normaliseRecipients(['nope', '', null, 'a@b.co'])).toEqual(['a@b.co'])
  })

  it('survives junk in place of a list', () => {
    expect(normaliseRecipients(null)).toEqual([])
    expect(normaliseRecipients('a@b.co')).toEqual([])
  })
})

describe('resolveRecipients', () => {
  it("uses the form's own list when it has one", () => {
    expect(resolveRecipients(['a@b.co'], ['x@y.co'], 'hello@z.co')).toEqual(['a@b.co'])
  })

  it('falls back to the agency default when the form has none', () => {
    expect(resolveRecipients(null, ['x@y.co'], 'hello@z.co')).toEqual(['x@y.co'])
  })

  it('falls back to the sending mailbox when nothing is configured', () => {
    expect(resolveRecipients(null, [], 'hello@z.co')).toEqual(['hello@z.co'])
    expect(resolveRecipients(undefined, null, 'hello@z.co')).toEqual(['hello@z.co'])
  })

  it('respects an empty list on the form as "notify nobody"', () => {
    expect(resolveRecipients([], ['x@y.co'], 'hello@z.co')).toEqual([])
  })
})
