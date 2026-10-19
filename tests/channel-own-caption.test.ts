import { describe, expect, it } from 'vitest'
import { validateComposition } from '../app/lib/social-schedule-core'
import { ownCaptions, readFrozenPost } from '../app/lib/portal-core'
import { clientRoundEmail } from '../app/lib/post-notify-core'
import { optionsFromExtras } from '../app/lib/schedule-compose-core'

/**
 * A CHANNEL'S OWN WORDS (the owner, 19 Oct 2026: "i have tiktok, linkedin and facebook but im unable to publish
 * different captions for each platform"). The words are `per_channel[id].caption`, Zernio's `customContent`; the
 * checks judge each channel on them, and every place the client approves the post shows them.
 */
describe('a channel judged on its own words', () => {
  const base = {
    item: { status: 'approved_for_scheduling', content_type: 'carousel' },
    version: { version_number: 1, files: [{ url: 'https://media.mdmmarketing.com.au/1.png' }] },
    slides: [{ url: 'https://media.mdmmarketing.com.au/1.png', name: '1.png', type: 'image' }],
    scheduledFor: null, withoutApproval: true, requireTime: false, now: '2026-10-19T00:00:00Z',
  }

  it('LinkedIn with its own words needs no shared caption', () => {
    const r = validateComposition({
      ...base, caption: '',
      channels: [{ id: 'li', platform: 'linkedin', kind: null, options: { caption: 'Words for LinkedIn' } }],
    } as never)
    expect(r.problems.join(' ')).not.toMatch(/needs a caption/)
  })

  it('a channel whose own words are too long is refused for that channel', () => {
    const r = validateComposition({
      ...base, caption: 'short',
      channels: [{ id: 'tw', platform: 'twitter', kind: null, options: { caption: 'x'.repeat(400) } }],
    } as never)
    expect(r.problems.join(' ')).toMatch(/too long/)
  })

  it('the shared caption is not held against a channel with shorter words of its own', () => {
    const r = validateComposition({
      ...base, caption: 'x'.repeat(400),
      channels: [{ id: 'tw', platform: 'twitter', kind: null, options: { caption: 'short' } }],
    } as never)
    expect(r.problems.join(' ')).not.toMatch(/too long/)
  })

  it('reaches the publisher as the channel option', () => {
    expect(optionsFromExtras({ caption: 'Words for TikTok' }).caption).toBe('Words for TikTok')
    expect(optionsFromExtras({ caption: '  ' }).caption).toBeUndefined()
  })
})

describe('what the client is shown', () => {
  const version = readFrozenPost({
    n: 2, caption: 'The shared caption', channels: ['ig', 'li', 'tt', 'fb'], slides: [],
    per_channel: {
      li: { caption: 'Words for LinkedIn' },
      tt: { caption: 'The shared caption' },   // the same words are not a difference
      fb: { caption: '   ' },
    },
  })!
  const platform: Record<string, string> = { ig: 'instagram', li: 'linkedin', tt: 'tiktok', fb: 'facebook' }

  it('keeps a channel caption on the frozen version', () => {
    expect(version.per_channel.li.caption).toBe('Words for LinkedIn')
    expect(version.per_channel.fb.caption).toBeUndefined()
  })

  it('lists only the networks whose words differ', () => {
    expect(ownCaptions(version, id => platform[id])).toEqual([
      { platform: 'linkedin', network: 'LinkedIn', caption: 'Words for LinkedIn' },
    ])
  })

  it('the approval email says which networks have different words', () => {
    const email = clientRoundEmail({
      clientName: 'ZZ E2E Test Client', hello: 'there', senderName: 'MD Media',
      posts: [{ id: 'p', title: 'A post', caption: 'The shared caption', own_words: ['linkedin'], when: null, networks: ['instagram', 'linkedin'], link: 'https://x', approve_by: null }],
    })
    expect(email.items[0].lines.join(' ')).toMatch(/LinkedIn has different words/)
  })
})
