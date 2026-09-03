import { describe, expect, it } from 'vitest'
import {
  APPROVAL_LINE, addToPost, clockPillLabel, composerReducer, footerActions,
  inPost, initialComposer, joinClock, limitsLine, moreOptionsFor, moveInPost,
  readLocations, readPerChannel, removeFromPost, replaceInPost, splitClock,
  to12, to24, NEW_VERSION_NOTICE, PAGE_ID_HELP, type ComposerState,
} from '@/app/lib/schedule-compose-core'
import { isPageId, kindTakesLocation, toPlatformData } from '@/app/lib/publish-core'
import { SOCIAL_POST_STATUSES } from '@/app/lib/social-schedule-core'
import type { Slide } from '@/app/lib/version-files-core'

/**
 * THE NEW POST WINDOW'S RULES.
 *
 * Everything in the composer that is a decision rather than a pixel: what the
 * window is holding, what a channel will take, what the clock says, which
 * file is in the post, and what the button at the bottom offers to whom.
 *
 * The last one is the important one. "Schedule without approval" appearing
 * for somebody who cannot approve is not a cosmetic bug — it is an invitation
 * to a refusal, and on a page whose entire purpose is that nothing goes out
 * unapproved, the button must not suggest otherwise.
 */

const slide = (n: string, type: 'image' | 'video' = 'image'): Slide =>
  ({ url: `https://files.example.invalid/${n}.${type === 'video' ? 'mp4' : 'jpg'}`, name: n, type })

const MELB = 'Australia/Melbourne'

describe('the window holds one composition', () => {
  const base = (): ComposerState => initialComposer({
    itemId: 'i1',
    slides: [slide('a')],
    scheduledFor: '2026-09-08T08:30:00.000Z',
    channels: ['acc1'],
  })

  it('starts clean — there is nothing to save before anybody types', () => {
    expect(base().dirty).toBe(false)
    expect(base().postId).toBeNull()
  })

  it('a change makes it dirty; the same value again does not', () => {
    const typed = composerReducer(base(), { type: 'caption', caption: 'Hello' })
    expect(typed.dirty).toBe(true)
    const again = composerReducer({ ...typed, dirty: false }, { type: 'caption', caption: 'Hello' })
    expect(again.dirty).toBe(false)
  })

  it('only a save or a load clears dirty — a failed save must leave it set', () => {
    const dirty = composerReducer(base(), { type: 'caption', caption: 'x' })
    expect(composerReducer(dirty, { type: 'saved', postId: 'p1' }))
      .toMatchObject({ dirty: false, postId: 'p1' })
    expect(composerReducer(dirty, { type: 'loaded', state: { caption: 'y' } }).dirty).toBe(false)
  })

  it('turning a channel off takes its own caption and first comment with it', () => {
    let s = composerReducer(base(), {
      type: 'extra', channel: 'acc1', patch: { firstComment: '#brunch' },
    })
    expect(s.perChannel.acc1.firstComment).toBe('#brunch')
    s = composerReducer(s, { type: 'channel', id: 'acc1', on: false })
    expect(s.channels).toEqual([])
    // otherwise turning it back on would silently post a hashtag nobody chose
    expect(s.perChannel.acc1).toBeUndefined()
  })

  it('turning a channel on that is already on changes nothing', () => {
    const s = base()
    expect(composerReducer(s, { type: 'channel', id: 'acc1', on: true })).toBe(s)
  })

  // THE ONE THAT COST A CLIENT'S APPROVAL.
  //
  // The window opened with an empty caption and empty per-channel extras even
  // when the post had both. Pressing Schedule then PATCHed the empties over
  // them, the server read that as a content change, and the client's posting
  // approval was taken back — from a click that was only meant to check the
  // time.
  it('opens holding everything the post already has', () => {
    const seeded = initialComposer({
      itemId: 'i1',
      postId: 'p1',
      slides: [slide('a')],
      caption: 'Spring is on the menu.',
      channels: ['acc1'],
      scheduledFor: '2026-09-08T08:30:00.000Z',
      perChannel: { acc1: { firstComment: '#brunch', locationId: '102938475610293' } },
    })
    expect(seeded.caption).toBe('Spring is on the menu.')
    expect(seeded.perChannel.acc1.firstComment).toBe('#brunch')
    expect(seeded.postId).toBe('p1')
    // seeding is not an edit
    expect(seeded.dirty).toBe(false)
  })

  it('takes the stored per-channel blob apart without trusting it', () => {
    expect(readPerChannel({
      acc1: {
        caption: 'hi', kind: 'reel', firstComment: '#x', shareToFeed: true,
        locationId: '102938475610293', collaborators: ['a', 'b', 'c', 'd'],
        somethingElse: 'dropped',
      },
      acc2: 'not an object',
    })).toEqual({
      acc1: {
        caption: 'hi', kind: 'reel', firstComment: '#x', shareToFeed: true,
        locationId: '102938475610293', collaborators: ['a', 'b', 'c'],
      },
    })
    expect(readPerChannel(null)).toEqual({})
    expect(readPerChannel([1, 2])).toEqual({})
  })

  it('a load replaces what is on screen and clears dirty; nothing else does', () => {
    const typed = composerReducer(base(), { type: 'caption', caption: 'mine' })
    const loaded = composerReducer(typed, {
      type: 'loaded',
      state: { caption: 'theirs', perChannel: { acc1: { firstComment: '#x' } } },
    })
    expect(loaded.caption).toBe('theirs')
    expect(loaded.perChannel.acc1.firstComment).toBe('#x')
    expect(loaded.dirty).toBe(false)
  })
})

describe('what each channel will take, said in words', () => {
  it('says it the way the design says it', () => {
    expect(limitsLine(['instagram', 'tiktok'], [slide('a'), slide('b')]))
      .toBe('Instagram carousel: up to 10 · TikTok photo post: up to 35')
  })

  it('says each channel once, however many accounts are on it', () => {
    expect(limitsLine(['instagram', 'instagram'], [slide('a')]))
      .toBe('Instagram carousel: up to 10')
  })

  it('counts by KIND — a video is a different ceiling from twelve pictures', () => {
    expect(limitsLine(['instagram'], [slide('clip', 'video')]))
      .toBe('Instagram video: one at a time')
  })

  it('a channel that takes no pictures says so rather than quoting a number', () => {
    expect(limitsLine(['youtube'], [slide('a')])).toBe('YouTube: video only')
  })

  it('leaves out a network we have no rules for rather than guessing', () => {
    expect(limitsLine(['myspace'], [slide('a')])).toBe('')
  })
})

describe('More options never offers what the provider cannot do', () => {
  it('offers a first comment where Zernio takes one', () => {
    expect(moreOptionsFor(['instagram']).map(o => o.key))
      .toEqual(['firstComment', 'collaborators', 'shareToFeed', 'location'])
  })

  it('does not offer collaborators on a network that has none', () => {
    expect(moreOptionsFor(['linkedin'])).toEqual([])
  })

  it('names the channels a row applies to, so no row is a mystery', () => {
    const rows = moreOptionsFor(['instagram', 'linkedin'])
    expect(rows.find(r => r.key === 'firstComment')?.platforms).toEqual(['instagram'])
  })

  it('takes the location row away on a Story', () => {
    // Instagram REFUSES a Story carrying a location rather than ignoring it,
    // so offering the field there is offering a post that cannot exist
    expect(moreOptionsFor(['instagram'], 'story').map(o => o.key)).not.toContain('location')
    for (const kind of ['feed', 'reel', 'carousel'] as const) {
      expect(moreOptionsFor(['instagram'], kind).map(o => o.key)).toContain('location')
    }
  })

  it('never offers a location anywhere but Instagram', () => {
    for (const p of ['facebook', 'tiktok', 'linkedin', 'threads', 'youtube']) {
      expect(moreOptionsFor([p]).map(o => o.key)).not.toContain('location')
    }
  })
})

describe('the places a client tags posts at', () => {
  it('takes a Facebook Page id and refuses everything else', () => {
    expect(isPageId('102938475610293')).toBe(true)
    // the mistake everybody makes: the @name, which Instagram answers by
    // refusing the post hours later with nobody watching
    expect(isPageId('@suikitchen')).toBe(false)
    expect(isPageId('Sui Kitchen')).toBe(false)
    expect(isPageId('123')).toBe(false)
    expect(isPageId(null)).toBe(false)
  })

  it('cleans a saved list rather than trusting it', () => {
    expect(readLocations([
      { name: 'Fitzroy', pageId: '102938475610293' },
      { name: '', pageId: '102938475610294' },
      { name: 'No id', pageId: 'suikitchen' },
      { name: 'Same id again', pageId: '102938475610293' },
    ])).toEqual([{ name: 'Fitzroy', pageId: '102938475610293' }])
  })

  it('reads a row saved under the database spelling too', () => {
    expect(readLocations([{ name: 'Fitzroy', page_id: '102938475610293' }]))
      .toEqual([{ name: 'Fitzroy', pageId: '102938475610293' }])
  })

  it('is a list, never null — nothing has to guard for both', () => {
    expect(readLocations(null)).toEqual([])
    expect(readLocations('nope')).toEqual([])
  })

  it('explains where the number comes from without saying "Graph API"', () => {
    expect(PAGE_ID_HELP).toMatch(/Facebook Page/)
    expect(PAGE_ID_HELP).toMatch(/not the @name/)
    expect(PAGE_ID_HELP.toLowerCase()).not.toContain('api')
  })

  it('sends the place to Instagram, and only to Instagram', () => {
    const o = { kind: 'feed' as const, locationId: '102938475610293' }
    expect(toPlatformData(o, 'instagram')).toMatchObject({ locationId: '102938475610293' })
    expect(toPlatformData(o, 'facebook')?.locationId).toBeUndefined()
    expect(toPlatformData(o, 'tiktok')?.locationId).toBeUndefined()
  })

  it('never sends one on a Story, which Instagram would refuse', () => {
    expect(kindTakesLocation('story')).toBe(false)
    expect(toPlatformData({ kind: 'story', locationId: '102938475610293' }, 'instagram')?.locationId)
      .toBeUndefined()
  })

  it('drops a place name typed into the id box rather than posting it', () => {
    expect(toPlatformData({ kind: 'feed', locationId: 'Sui Kitchen' }, 'instagram'))
      .toBeNull()
  })
})

describe("the clock is the client's", () => {
  it('reads midnight and noon the way a person does', () => {
    expect(to12(0)).toEqual({ hour12: 12, meridiem: 'am' })
    expect(to12(12)).toEqual({ hour12: 12, meridiem: 'pm' })
    expect(to12(13)).toEqual({ hour12: 1, meridiem: 'pm' })
    expect(to24(12, 'am')).toBe(0)
    expect(to24(12, 'pm')).toBe(12)
    expect(to24(1, 'pm')).toBe(13)
  })

  it('splits and joins as inverses through the client zone', () => {
    // 6:30 pm in Melbourne on 8 September 2026 (AEST, UTC+10)
    const iso = '2026-09-08T08:30:00.000Z'
    const parts = splitClock(iso, MELB)
    expect(parts).toEqual({ dayKey: '2026-09-08', hour12: 6, minute: 30, meridiem: 'pm' })
    expect(joinClock(parts, MELB)).toBe(iso)
  })

  it('is still the inverse across the weekend the clocks change', () => {
    // Melbourne moves to AEDT on 4 October 2026
    const iso = '2026-10-05T08:30:00.000Z'
    const parts = splitClock(iso, MELB)
    expect(parts?.hour12).toBe(7)
    expect(joinClock(parts, MELB)).toBe(iso)
  })

  it('reads the same instant differently in a different zone — which is the point', () => {
    expect(splitClock('2026-09-08T08:30:00.000Z', 'Asia/Manila'))
      .toEqual({ dayKey: '2026-09-08', hour12: 4, minute: 30, meridiem: 'pm' })
  })

  it('refuses a day it cannot read rather than inventing one', () => {
    expect(joinClock({ dayKey: 'someday', hour12: 6, minute: 0, meridiem: 'pm' }, MELB)).toBeNull()
    expect(joinClock(null, MELB)).toBeNull()
    expect(splitClock(null, MELB)).toBeNull()
  })

  it('labels the pill the way the mockup does', () => {
    // "Sept" not "Sep": the month is spelled by the platform's en-AU data,
    // the same as every other date on the page. Pinning the mockup's
    // abbreviation here would make the composer the one screen that spells
    // September differently from the week above it.
    expect(clockPillLabel('2026-09-08T08:30:00.000Z', MELB)).toMatch(/^Tue 8 Sept? · 6:30 pm$/)
  })

  it('says to pick one rather than showing a blank pill', () => {
    expect(clockPillLabel(null, MELB)).toBe('Pick a time')
  })
})

describe('what is in the post', () => {
  const a = slide('a'), b = slide('b'), c = slide('c')

  it('adds at the end by default and at a slot when one is named', () => {
    expect(addToPost([a], b).map(s => s.name)).toEqual(['a', 'b'])
    expect(addToPost([a, b], c, 0).map(s => s.name)).toEqual(['c', 'a', 'b'])
  })

  it('the same file dragged again is a MOVE, never a second copy', () => {
    expect(addToPost([a, b], a, 1).map(s => s.name)).toEqual(['b', 'a'])
    expect(addToPost([a, b], a).map(s => s.name)).toEqual(['a', 'b'])
  })

  it('takes a file out by url', () => {
    expect(removeFromPost([a, b], a.url).map(s => s.name)).toEqual(['b'])
  })

  it('reorders inside the post', () => {
    expect(moveInPost([a, b, c], 2, 0).map(s => s.name)).toEqual(['c', 'a', 'b'])
  })

  it('replacing a slot with a file already in the post leaves one of it', () => {
    expect(replaceInPost([a, b, c], 0, c).map(s => s.name)).toEqual(['c', 'b'])
  })

  it('leaves the post alone when the slot does not exist', () => {
    expect(replaceInPost([a], 4, b).map(s => s.name)).toEqual(['a'])
  })

  it('knows what is already there, so the library can fade it', () => {
    expect(inPost([a], a.url)).toBe(true)
    expect(inPost([a], b.url)).toBe(false)
  })

  it('says the new-version rule in plain words, and never says "graphic"', () => {
    expect(NEW_VERSION_NOTICE).toMatch(/new version/)
    expect(NEW_VERSION_NOTICE).toMatch(/client's approval/)
    expect(NEW_VERSION_NOTICE.toLowerCase()).not.toContain('graphic')
  })
})

describe('the button at the bottom offers only what this person may do', () => {
  const scheduler = { mayApprove: false, mayPublish: true }
  const manager = { mayApprove: true, mayPublish: true }
  const editor = { mayApprove: false, mayPublish: false }

  it('a scheduler is never offered "Schedule without approval"', () => {
    const { primary, menu } = footerActions({ status: 'draft', ...scheduler })
    expect(primary.label).toBe('Send for approval')
    expect(menu.map(m => m.key)).toEqual(['draft'])
  })

  it('an account manager is — they could have approved it anyway', () => {
    const { menu } = footerActions({ status: 'draft', ...manager })
    expect(menu.map(m => m.key)).toEqual(['draft', 'direct'])
    expect(menu[1].label).toBe('Schedule without approval')
  })

  it('after approval the people who may publish get Schedule and Post now', () => {
    const { primary, menu } = footerActions({ status: 'approved', ...scheduler })
    expect(primary).toEqual({ key: 'schedule', label: 'Schedule' })
    expect(menu.map(m => m.key)).toEqual(['now'])
  })

  it('…and somebody who may not publish is told who does, not given a dead button', () => {
    const { primary, menu } = footerActions({ status: 'approved', ...editor })
    expect(primary.key).toBe('none')
    expect(primary.label).toMatch(/scheduler/)
    expect(menu).toEqual([])
  })

  it('a post already booked in or finished has nothing to press', () => {
    for (const status of ['scheduled', 'published', 'failed', 'cancelled'] as const) {
      expect(footerActions({ status, ...manager }).primary.key).toBe('none')
    }
  })

  it('a post waiting on somebody can be sent again rather than sent twice', () => {
    expect(footerActions({ status: 'pending', ...scheduler }).primary.label).toBe('Send again')
  })

  it('gives every status a sentence for the footer pill', () => {
    for (const status of SOCIAL_POST_STATUSES) {
      expect(APPROVAL_LINE[status], status).toBeTruthy()
      expect(APPROVAL_LINE[status].toLowerCase()).not.toContain('graphic')
    }
  })
})
