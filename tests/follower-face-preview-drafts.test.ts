import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { initialOf, pictureExpiry, pictureUsable } from '../app/lib/follower-avatar-core'
import { previewOrder } from '../app/lib/schedule-drag-core'

/**
 * A FOLLOWER'S FACE, AND DRAFTS IN THE FEED PREVIEW (the owner, 24 Sep 2026:
 * "the followers profile image is not showing"; Divina and the owner's
 * manager the same day: "allow drafts on schedule still appear on preview").
 */
describe('a follower’s picture', () => {
  // the two addresses read off Justin's list on 24 Sep 2026: the fresh one answered 200, the old one 403
  const fresh = 'https://scontent.cdninstagram.com/v/t51.1-19/x.jpg?stp=dst-jpg&_nc_ht=scontent.cdninstagram.com&oh=00_AQ&oe=6ABA136D'
  const lapsed = 'https://scontent-lax3-2.cdninstagram.com/v/t51.2885-19/y.jpg?_nc_cat=107&oh=00_AQ&oe=6AAE7279'

  it('reads the expiry the CDN signs into the address', () => {
    expect(pictureExpiry(fresh)?.toISOString()).toBe('2026-09-28T07:12:45.000Z')
    expect(pictureExpiry(lapsed)?.toISOString()).toBe('2026-09-19T11:31:05.000Z')
    expect(pictureExpiry('https://example.com/a.jpg')).toBeNull()
    expect(pictureExpiry(null)).toBeNull()
  })

  it('does not ask for a picture whose date has passed, and still tries one with no date', () => {
    const now = new Date('2026-09-24T04:00:00.000Z')
    expect(pictureUsable(fresh, now)).toBe(true)
    expect(pictureUsable(lapsed, now)).toBe(false)
    expect(pictureUsable('https://example.com/a.jpg', now)).toBe(true)
    expect(pictureUsable(null, now)).toBe(false)
    expect(pictureUsable('  ', now)).toBe(false)
  })

  it('draws a letter in its place, from the name when there is one', () => {
    expect(initialOf('42_kelso', 'Kelvin Page')).toBe('K')
    expect(initialOf('42_kelso', null)).toBe('4')
    expect(initialOf('_hidden', '')).toBe('H')
    expect(initialOf(null)).toBe('?')
    expect(initialOf('урош', null)).toBe('У')
  })

  it('the page tries the picture, and falls back when the address is refused anyway', () => {
    const page = readFileSync('app/dashboard/social/[id]/followers/page.tsx', 'utf8')
    expect(page).toContain('const show = !broken && pictureUsable(person.profile_pic)')
    expect(page).toContain('onError={() => setBroken(true)}')
    expect(page).toContain('{initialOf(person.username, person.full_name)}')
  })
})

describe('drafts in the feed preview', () => {
  it('a post with no time yet sits at the front, and the dated ones keep the feed’s order', () => {
    const posts = [
      { id: 'a', scheduled_for: '2026-09-25T02:00:00.000Z' },
      { id: 'b', scheduled_for: null },
      { id: 'c', scheduled_for: '2026-09-27T02:00:00.000Z' },
      { id: 'd', scheduled_for: '' },
    ]
    expect(previewOrder(posts).map(p => p.id)).toEqual(['b', 'd', 'c', 'a'])
    expect(previewOrder([] as typeof posts).map(p => p.id)).toEqual([])
  })

  it('the Preview is given every post on the channel, and says which are drafts', () => {
    const page = readFileSync('app/dashboard/social/schedule/page.tsx', 'utf8')
    expect(page).toContain('<PreviewGrid posts={channelPosts} tz={tz} onOpen={flow.openPost} />')
    // the grids still hide drafts; only the Preview shows them
    expect(page).toContain('const planned = useMemo(() => channelPosts.filter(showsOnGrid), [channelPosts])')
    const views = readFileSync('app/dashboard/social/schedule/views.tsx', 'utf8')
    expect(views).toContain("{p.live_status === 'draft' && (")
    expect(views).toContain('>Draft</span>')
  })
})
