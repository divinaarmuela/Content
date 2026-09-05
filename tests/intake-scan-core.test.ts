import { describe, expect, it } from 'vitest'
import {
  classifyUpload, isRefusal, normaliseScan, questionKey, repairJson, truncateDocument,
  MAX_DOC_CHARS, MAX_SCAN_BYTES,
} from '../app/lib/intake-scan-core'
import type { Block } from '../app/lib/intake-core'

/**
 * The validator between a language model and a form a real client fills in.
 *
 * Everything here is what a model has actually been seen to do: invent a
 * question type, forget the choices on a multiple-choice question, hand back
 * the page number as a question, repeat the same field on every page, or
 * confidently structure a restaurant menu. None of it may reach the builder
 * unrepaired, and none of it may throw.
 */

const blocks = (out: ReturnType<typeof normaliseScan>): Block[] => {
  if (!out.ok) throw new Error(`expected a draft, got: ${out.message}`)
  return out.definition.sections.flatMap(s => s.blocks)
}
const draft = (questions: unknown[], extra: Record<string, unknown> = {}) =>
  normaliseScan({ is_form: true, name: 'New client form', sections: [{ title: 'About you', questions }], ...extra }, 'one_off')

describe('classifyUpload — what we will read', () => {
  it('accepts a PDF, by type or by extension', () => {
    expect(classifyUpload('form.pdf', 'application/pdf', 1000)).toEqual({ kind: 'pdf', mediaType: 'application/pdf' })
    // mail clients hand over octet-stream; the extension still decides
    expect(classifyUpload('form.pdf', 'application/octet-stream', 1000)).toMatchObject({ kind: 'pdf' })
  })

  it('accepts the three image types and normalises jpg', () => {
    expect(classifyUpload('page.png', 'image/png', 10)).toEqual({ kind: 'image', mediaType: 'image/png' })
    expect(classifyUpload('page.jpg', '', 10)).toEqual({ kind: 'image', mediaType: 'image/jpeg' })
    expect(classifyUpload('page.webp', 'image/webp', 10)).toEqual({ kind: 'image', mediaType: 'image/webp' })
  })

  it('accepts plain text and Markdown', () => {
    expect(classifyUpload('notes.txt', 'text/plain', 10)).toMatchObject({ kind: 'text' })
    expect(classifyUpload('notes.md', '', 10)).toMatchObject({ kind: 'text' })
  })

  it('refuses Word with its own sentence, telling the person what to do', () => {
    const out = classifyUpload('brief.docx', '', 1000)
    expect(isRefusal(out)).toBe(true)
    if (!isRefusal(out)) return
    expect(out.message).toContain('PDF')
    expect(out.status).toBe(415)
  })

  it('refuses anything else in plain words', () => {
    const out = classifyUpload('deck.pptx', 'application/vnd.ms-powerpoint', 1000)
    expect(isRefusal(out) && out.status).toBe(415)
    expect(isRefusal(out) && out.message).toMatch(/PDFs/)
  })

  it('refuses an empty file and one over 20 MB', () => {
    expect(isRefusal(classifyUpload('form.pdf', 'application/pdf', 0))).toBe(true)
    const big = classifyUpload('form.pdf', 'application/pdf', MAX_SCAN_BYTES + 1)
    expect(isRefusal(big) && big.status).toBe(413)
    expect(isRefusal(big) && big.message).toContain('20 MB')
  })
})

describe('truncateDocument', () => {
  it('leaves a normal document alone', () => {
    expect(truncateDocument('short').note).toBeNull()
  })

  it('cuts a huge one and says how much was read', () => {
    const { text, note } = truncateDocument('x'.repeat(MAX_DOC_CHARS * 4))
    expect(text.length).toBe(MAX_DOC_CHARS)
    expect(note).toMatch(/only the first 25% of it was read/)
  })
})

describe('repairJson', () => {
  it('parses clean JSON', () => {
    expect(repairJson('{"a":1}')).toEqual({ a: 1 })
  })
  it('unwraps a fenced block', () => {
    expect(repairJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })
  it('pulls the object out of chatter and drops a trailing comma', () => {
    expect(repairJson('Here you go: {"a":1,"b":[2,],}\nHope that helps')).toEqual({ a: 1, b: [2] })
  })
  it('returns null for something unrecoverable rather than throwing', () => {
    expect(repairJson('I am afraid I cannot do that')).toBeNull()
    expect(repairJson('')).toBeNull()
  })
})

describe('normaliseScan — every question type', () => {
  it('keeps each type we render, with its choices', () => {
    const out = draft([
      { label: 'Your name', type: 'short_text', confidence: 'high' },
      { label: 'Tell us about the business', type: 'long_text', confidence: 'high' },
      { label: 'Website', type: 'link', confidence: 'high' },
      { label: 'How did you hear about us', type: 'select', choices: ['Google', 'A friend'], confidence: 'high' },
      { label: 'Which services', type: 'multi_select', choices: ['Photo', 'Video'], confidence: 'high' },
      { label: 'Upload your logo', type: 'file', confidence: 'high' },
      { label: 'Take your time with this one', type: 'guidance', confidence: 'high' },
    ])
    expect(blocks(out).map(b => b.type)).toEqual([
      'short_text', 'long_text', 'link', 'select', 'multi_select', 'file', 'guidance',
    ])
    expect(blocks(out)[3].options).toEqual(['Google', 'A friend'])
  })

  it('maps synonyms and real types we have no control for onto the nearest one', () => {
    const out = draft([
      { label: 'Opening date', type: 'date', confidence: 'high' },
      { label: 'Your email', type: 'email', confidence: 'high' },
      { label: 'Anything else', type: 'textarea', confidence: 'high' },
      { label: 'Tick all that apply', type: 'checkbox', choices: ['A', 'B'], confidence: 'high' },
      { label: 'Do you have a logo', type: 'yes_no', confidence: 'high' },
    ])
    expect(blocks(out).map(b => b.type)).toEqual([
      'short_text', 'short_text', 'long_text', 'multi_select', 'select',
    ])
    // yes/no arrives with no choices printed; the two obvious ones are supplied
    expect(blocks(out)[4].options).toEqual(['Yes', 'No'])
  })

  it('turns an unknown type into a short answer and flags it for a human', () => {
    const out = draft([{ label: 'Rate our vibe on a slider', type: 'slider_widget', confidence: 'high' }])
    if (!out.ok) throw new Error(out.message)
    expect(out.definition.sections[0].blocks[0].type).toBe('short_text')
    expect(out.uncertain).toEqual([out.definition.sections[0].blocks[0].id])
    expect(out.notes.join(' ')).toMatch(/kind we do not have/)
  })

  it('flags a question the model itself was unsure about', () => {
    const out = draft([
      { label: 'Your name', type: 'short_text', confidence: 'high' },
      { label: 'Something smudged', type: 'short_text', confidence: 'low' },
    ])
    if (!out.ok) throw new Error(out.message)
    expect(out.uncertain).toHaveLength(1)
    expect(out.definition.sections[0].blocks[1].id).toBe(out.uncertain[0])
  })

  it('every flagged id exists in the definition it hands back', () => {
    const out = draft([
      { label: 'Section', type: 'mystery', confidence: 'low' },
      { label: 'Pick one', type: 'select', choices: ['only'], confidence: 'high' },
    ])
    if (!out.ok) throw new Error(out.message)
    const ids = new Set(out.definition.sections.flatMap(s => s.blocks).map(b => b.id))
    for (const id of out.uncertain) expect(ids.has(id)).toBe(true)
  })
})

describe('normaliseScan — repairs', () => {
  it('rescues a choice question with no choices, rather than shipping an empty dropdown', () => {
    const out = draft([
      { label: 'What is your budget', type: 'select', choices: [], confidence: 'high' },
      { label: 'Which platforms', type: 'multi_select', choices: ['Instagram'], confidence: 'high' },
    ])
    if (!out.ok) throw new Error(out.message)
    expect(out.definition.sections[0].blocks.map(b => b.type)).toEqual(['short_text', 'short_text'])
    expect(out.uncertain).toHaveLength(2)
    expect(out.notes.join(' ')).toMatch(/no choices/)
  })

  it('collapses duplicate questions however the document punctuated them', () => {
    const out = draft([
      { label: 'Business name', type: 'short_text', confidence: 'high' },
      { label: 'Business name:', type: 'short_text', confidence: 'high' },
      { label: 'BUSINESS   NAME', type: 'short_text', confidence: 'high' },
      { label: 'Trading name', type: 'short_text', confidence: 'high' },
    ])
    expect(blocks(out).map(b => b.label)).toEqual(['Business name', 'Trading name'])
    if (!out.ok) throw new Error(out.message)
    expect(out.notes.join(' ')).toMatch(/2 repeated questions were merged/)
  })

  it('drops page furniture', () => {
    const out = draft([
      { label: 'Page 3 of 12', type: 'short_text', confidence: 'high' },
      { label: '  7 ', type: 'short_text', confidence: 'high' },
      { label: '© 2026 Acme Pty Ltd', type: 'guidance', confidence: 'high' },
      { label: 'FOR OFFICE USE ONLY', type: 'short_text', confidence: 'high' },
      { label: 'www.acme.com.au', type: 'link', confidence: 'high' },
      { label: 'Logo', type: 'file', confidence: 'high' },
      { label: 'Your name', type: 'short_text', confidence: 'high' },
    ])
    expect(blocks(out).map(b => b.label)).toEqual(['Your name'])
  })

  it('drops a section with nothing left in it, and refuses when nothing survives', () => {
    const mixed = normaliseScan({
      is_form: true,
      sections: [
        { title: 'Cover', questions: [{ label: 'Page 1 of 4', type: 'short_text', confidence: 'high' }] },
        { title: 'Empty heading', questions: [] },
        { title: 'You', questions: [{ label: 'Your name', type: 'short_text', confidence: 'high' }] },
      ],
    }, 'one_off')
    if (!mixed.ok) throw new Error(mixed.message)
    expect(mixed.definition.sections.map(s => s.title)).toEqual(['You'])

    const nothing = normaliseScan({ is_form: true, sections: [{ title: 'Cover', questions: [] }] }, 'one_off')
    expect(nothing.ok).toBe(false)
    expect(!nothing.ok && nothing.message).toMatch(/could not find any questions/)
  })

  it('accepts a flat list of questions with no sections at all', () => {
    const out = normaliseScan({
      is_form: true, name: 'Quick brief',
      questions: [{ label: 'Your name', type: 'short_text', confidence: 'high' }],
    }, 'one_off')
    expect(blocks(out)).toHaveLength(1)
  })

  it('carries the truncation note through to the person reviewing', () => {
    const out = normaliseScan(
      { is_form: true, sections: [{ title: 'You', questions: [{ label: 'Your name', type: 'short_text', confidence: 'high' }] }] },
      'one_off',
      { notes: ['That document was long, so only the first 25% of it was read. Check the end of your form for anything missing.'] },
    )
    if (!out.ok) throw new Error(out.message)
    expect(out.notes[0]).toMatch(/only the first 25%/)
  })

  it('keeps the template key it was given, and gives every question a unique id', () => {
    const out = normaliseScan({
      is_form: true,
      sections: [
        { title: 'You', questions: [{ label: 'Name', type: 'short_text', confidence: 'high' }] },
        { title: 'You', questions: [{ label: 'Name of your business', type: 'short_text', confidence: 'high' }] },
      ],
    }, 'rebrand')
    if (!out.ok) throw new Error(out.message)
    expect(out.definition.key).toBe('rebrand')
    const ids = out.definition.sections.flatMap(s => [s.id, ...s.blocks.map(b => b.id)])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('normaliseScan — refusals', () => {
  it('honours a not-a-form verdict instead of drafting nonsense', () => {
    const out = normaliseScan({
      is_form: false,
      not_a_form_reason: 'It is a restaurant menu.',
      sections: [{ title: 'Entrees', questions: [{ label: 'Garlic bread', type: 'short_text', confidence: 'low' }] }],
    }, 'one_off')
    expect(out.ok).toBe(false)
    expect(!out.ok && out.message).toBe('This does not look like a form. It is a restaurant menu.')
  })

  it('says so plainly when the pages could not be read', () => {
    const out = normaliseScan({ is_form: true, unreadable: true, unreadable_reason: 'The handwriting is too faint.' }, 'one_off')
    expect(out.ok).toBe(false)
    expect(!out.ok && out.message).toMatch(/could not read that document/i)
  })

  it('never throws on rubbish', () => {
    for (const rubbish of [null, undefined, 'nope', 42, [], { sections: 'no' }, { sections: [null] }]) {
      expect(() => normaliseScan(rubbish, 'one_off')).not.toThrow()
      expect(normaliseScan(rubbish, 'one_off').ok).toBe(false)
    }
  })
})

describe('questionKey', () => {
  it('ignores punctuation, case and spacing', () => {
    expect(questionKey('Business name:')).toBe(questionKey('BUSINESS   NAME'))
    expect(questionKey('Business name')).not.toBe(questionKey('Trading name'))
  })
})
