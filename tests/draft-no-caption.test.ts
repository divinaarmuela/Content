import { describe, expect, it } from 'vitest'
import { validateComposition } from '../app/lib/social-schedule-core'

/**
 * A DRAFT OWES NO CAPTION (the owner's video, 28 Sep 2026). Reordering Jordan Wilson's 14 LinkedIn slides was refused
 * with "LinkedIn needs a caption", the refusal was drawn behind the media window, and Save looked like it did nothing.
 * The caption is owed when the post goes out — never to write a draft down.
 */
describe('the LinkedIn caption rule', () => {
  const base = {
    item: { status: 'approved_for_scheduling', content_type: 'carousel' },
    version: { version_number: 1, files: [{ url: 'https://media.mdmmarketing.com.au/1.png' }, { url: 'https://media.mdmmarketing.com.au/2.png' }] },
    slides: [{ url: 'https://media.mdmmarketing.com.au/1.png', name: '1.png', type: 'image' }, { url: 'https://media.mdmmarketing.com.au/2.png', name: '2.png', type: 'image' }],
    caption: '',
    channels: [{ id: 'li', platform: 'linkedin', kind: null, options: {} }],
    scheduledFor: null, withoutApproval: true, requireTime: false, now: '2026-09-28T00:00:00Z',
  }
  it('is not asked of a draft being saved', () => {
    const r = validateComposition({ ...base, saving: true, draft: true } as never)
    expect(r.problems.join(' ')).not.toMatch(/needs a caption/)
  })
  it('is still asked when the post goes out', () => {
    const r = validateComposition({ ...base, saving: false, draft: false } as never)
    expect(r.problems.join(' ')).toMatch(/LinkedIn needs a caption/)
  })
})
