import { describe, expect, it } from 'vitest'
import { repeatsAComment, withoutRepeatedNotes } from '../app/lib/card-comment-core'

/** SAID ALREADY (the owner, 22 Sep 2026: "comment showing two is not right — that's not two comments") */
describe('a note that repeats a comment is that comment', () => {
  const laura = { id: 'c1', body: 'The spread here food already eaten\n— Laura', video_file_id: 'clip1' }
  const copy = { id: 'c2', body: 'The spread here food already eaten\n— Laura', video_file_id: null }
  const other = { id: 'c3', body: 'Bigger logo, please', video_file_id: null }

  it('the thread knows its own words, whatever the spacing or case', () => {
    expect(repeatsAComment('the spread here food already eaten — laura', [laura])).toBe(true)
    expect(repeatsAComment('  The spread here food already eaten\n\n— Laura ', [laura])).toBe(true)
    expect(repeatsAComment('Bigger logo, please', [laura])).toBe(false)
    expect(repeatsAComment('', [laura, { body: '' }])).toBe(false)
  })
  it('the card draws the copy once, on the clip; other notes stay', () => {
    expect(withoutRepeatedNotes([laura, copy, other]).map(c => c.id)).toEqual(['c1', 'c3'])
    expect(withoutRepeatedNotes([copy, other]).map(c => c.id)).toEqual(['c2', 'c3'])
  })
})
