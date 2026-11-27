import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLIENT_WORD_LABEL, CLIENT_WORDS, clientWord, clientWordCounts,
  previewAccount, previewAccounts, previewCaption, previewCover, previewShape,
} from '../app/lib/schedule-client-word-core'

const yes = { version: 1, verdict: 'approved', by: 'Abby', at: '2026-11-20T00:00:00.000Z' }
const no = { version: 1, verdict: 'not_approved', by: 'Abby', at: '2026-11-20T00:00:00.000Z' }

describe('clientWord — where the client stands on a post still to go out', () => {
  it('a yes or a no is theirs, whatever the team chose', () => {
    expect(clientWord({ stage: 'booked', client_review: yes, if_no_answer: 'wait' })).toBe('approved')
    expect(clientWord({ stage: 'booked', client_review: yes, if_no_answer: 'none' })).toBe('approved')
    expect(clientWord({ stage: 'ready', client_review: no, sent_version: 1 })).toBe('not_approved')
  })

  it('with no answer, the team’s choice decides — and unset is "post anyway"', () => {
    expect(clientWord({ stage: 'booked' })).toBe('posts_anyway')
    expect(clientWord({ stage: 'booked', if_no_answer: 'post' })).toBe('posts_anyway')
    expect(clientWord({ stage: 'booked', if_no_answer: 'wait' })).toBe('waiting')
    expect(clientWord({ stage: 'booked', if_no_answer: 'none' })).toBe('no_approval')
  })

  it('a no on an older version, fixed and booked again, is unanswered', () => {
    expect(clientWord({ stage: 'booked', client_review: no, sent_version: 2, if_no_answer: 'wait' })).toBe('waiting')
  })

  it('sent to them again after their yes, for a newer version, is unanswered', () => {
    const again = { version: 2, at: '2026-11-22T00:00:00.000Z', by: null }
    expect(clientWord({ stage: 'booked', client_review: yes, review_asked: again, if_no_answer: 'wait' })).toBe('waiting')
  })

  it('a post that is out, cancelled or a draft has no word', () => {
    for (const stage of ['posted', 'cancelled', 'draft', 'check']) expect(clientWord({ stage, client_review: yes }), stage).toBeNull()
  })

  it('counts every word, 0 where none stand; each has plain words', () => {
    const counts = clientWordCounts([
      { stage: 'booked' }, { stage: 'booked', if_no_answer: 'wait' }, { stage: 'ready', if_no_answer: 'wait' },
      { stage: 'booked', client_review: yes }, { stage: 'posted', client_review: yes },
    ])
    expect(counts).toEqual({ waiting: 2, not_approved: 0, posts_anyway: 1, approved: 1, no_approval: 0 })
    expect(CLIENT_WORDS.map(w => CLIENT_WORD_LABEL[w])).toEqual([
      'Waiting for client', 'Client: not approved', 'Not reviewed — posts anyway', 'Client approved', 'No approval needed',
    ])
  })
})

describe('the Preview, one account at a time (27 Nov 2026: "its only showing instagram")', () => {
  const accounts = [
    { id: 'yt', platform: 'youtube' }, { id: 'li', platform: 'linkedin' }, { id: 'tt', platform: 'tiktok' },
    { id: 'fb', platform: 'facebook' }, { id: 'ig', platform: 'instagram' }, { id: 'old', platform: 'instagram', active: false },
  ]

  it('offers the four networks the portal draws, Instagram first, connected accounts only', () => {
    expect(previewAccounts(accounts).map(a => a.id)).toEqual(['ig', 'fb', 'tt', 'li'])
  })

  it('opens on the one pressed, else the one picked in the bar above, else the first', () => {
    expect(previewAccount(accounts, 'tt', 'fb')?.id).toBe('tt')
    expect(previewAccount(accounts, null, 'fb')?.id).toBe('fb')
    expect(previewAccount(accounts, null, 'yt')?.id).toBe('ig')
    expect(previewAccount(accounts, 'gone', null)?.id).toBe('ig')
    expect(previewAccount([{ id: 'yt', platform: 'youtube' }], null, null)).toBeNull()
  })

  it('Instagram and TikTok are grids, Facebook and LinkedIn are a column of posts', () => {
    expect(['instagram', 'tiktok', 'facebook', 'linkedin'].map(previewShape)).toEqual(['grid', 'tall-grid', 'cards', 'cards'])
  })

  it('an account leads with its chosen cover, else its own files, else the post’s', () => {
    const post = {
      slides: [{ url: 'main.mov', type: 'video' }], caption: 'The words',
      per_channel: { ig: { thumbnailUrl: 'cover.jpg' }, tt: { videoCoverImageUrl: 'tt.jpg' }, fb: { slides: [{ url: 'fb.png', type: 'image' }], caption: ' Facebook words ' } },
    }
    expect(previewCover(post, 'ig')).toEqual({ url: 'cover.jpg', type: 'image' })
    expect(previewCover(post, 'tt')).toEqual({ url: 'tt.jpg', type: 'image' })
    expect(previewCover(post, 'fb')).toEqual({ url: 'fb.png', type: 'image' })
    expect(previewCover(post, 'li')).toEqual({ url: 'main.mov', type: 'video' })
    expect(previewCover({ slides: [] }, 'ig')).toBeNull()
    expect(previewCaption(post, 'fb')).toBe('Facebook words')
    expect(previewCaption(post, 'ig')).toBe('The words')
  })
})

describe('on the page', () => {
  const views = readFileSync('app/dashboard/social/schedule/views.tsx', 'utf8')
  const page = readFileSync('app/dashboard/social/schedule/page.tsx', 'utf8')

  it('the Preview has a button per connected account and draws the one pressed', () => {
    expect(views).toContain('{offered.map(a => (')
    expect(views).toContain('data-preview-account={a.platform}')
    expect(views).toContain('const account = previewAccount(accounts, pickedId, barAccountId)')
  })

  it('every tile of a post still to go out says where the client stands', () => {
    expect((views.match(/<ClientWordMark post={p}/g) ?? []).length).toBe(2)
  })

  it('the counts row says where the client stands too, and a press lists those posts', () => {
    expect(page).toContain('{CLIENT_WORDS.map(word => {')
    expect(page).toContain('onClick={() => showClient(word)}')
    expect(page).toContain('if (clientFilter) return channelPosts.filter(p => clientWord(p) === clientFilter)')
  })
})
