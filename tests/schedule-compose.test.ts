import { describe, expect, it } from 'vitest'
import {
  APPROVAL_LINE, addToPost, clockPillLabel, composerReducer, footerActions,
  inPost, initialComposer, isPostingNow, joinClock, limitsLine, moreOptionsFor, moveInPost,
  readLocations, readPerChannel, removeFromPost, replaceInPost, splitClock,
  to12, to24, NEW_VERSION_NOTICE, PAGE_ID_HELP, type ComposerState,
  CHANNEL_EXTRA_KEYS, groupOptions, optionsFromExtras, readChannelExtras,
  SEND_FOR_REVIEW, sentForReviewLine,
  composerWait, mediaApprovalBadge, WAITING_ON_MANAGER,
  CLIENT_APPROVED_BADGE, NEW_MEDIA_BADGE, NOT_CLIENT_SIGNED_BADGE, TEAM_APPROVED_BADGE,
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

  it('carries a field it does not edit rather than dropping it', () => {
    // `slides` — a channel's own media set — is kept by the SERVER's
    // PerChannel and compared on save. Dropping it here would send it back as
    // absent, which the server reads as a content change: the field is gone
    // from the row and the client's approval goes with it. Nothing writes it
    // today; this is what stops that being a silent trap when something does.
    const own = [{ url: 'https://x.invalid/a.jpg', name: 'a.jpg', type: 'image' as const }]
    expect(readPerChannel({ acc1: { slides: own } })).toEqual({ acc1: { slides: own } })
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
      .toEqual([
        'firstComment', 'collaborators', 'shareToFeed', 'location',
        // the two Reel settings: with no post type chosen yet, a setting is
        // shown rather than hidden from somebody looking for it
        'trialReel', 'audioName',
      ])
  })

  it('does not offer collaborators on a network that has none', () => {
    expect(moreOptionsFor(['linkedin']).map(o => o.key)).not.toContain('collaborators')
  })

  it('offers each network only its OWN settings', () => {
    // LinkedIn takes a first comment, a company page, a link preview and a
    // document name — and none of Instagram's
    expect(moreOptionsFor(['linkedin']).map(o => o.key))
      .toEqual(['firstComment', 'liOrganization', 'liLinkPreview', 'liDocumentTitle'])
    expect(moreOptionsFor(['youtube']).map(o => o.key)).toEqual([
      'firstComment', 'ytTitle', 'ytVisibility', 'ytCategory', 'ytPlaylist',
      'ytTags', 'ytKids', 'ytSynthetic', 'ytThumbnail',
    ])
    // TikTok's consent tick is always there, because a TikTok post cannot go
    // out without it
    expect(moreOptionsFor(['tiktok']).map(o => o.key)).toContain('ttConsent')
    expect(moreOptionsFor(['tiktok']).map(o => o.key)).not.toContain('firstComment')
  })

  it('names the channels a row applies to, so no row is a mystery', () => {
    const rows = moreOptionsFor(['instagram', 'linkedin'])
    expect(rows.find(r => r.key === 'firstComment')?.platforms)
      .toEqual(['instagram', 'linkedin'])
    expect(rows.find(r => r.key === 'collaborators')?.platforms).toEqual(['instagram'])
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
    expect(primary.label).toBe(SEND_FOR_REVIEW)
    expect(menu.map(m => m.key)).toEqual(['draft'])
  })

  it('an account manager just posts — one press, no approval step', () => {
    const { primary, menu } = footerActions({ status: 'draft', ...manager })
    expect(primary).toEqual({ key: 'direct', label: 'Schedule' })
    // asking is still there, one press away, for when they want it
    expect(menu.map(m => m.key)).toEqual(['send', 'draft'])
    expect(menu[0].label).toBe(SEND_FOR_REVIEW)
  })

  it('…and "Post now" when the time they picked is now', () => {
    const { primary } = footerActions({ status: 'draft', ...manager, postingNow: true })
    expect(primary).toEqual({ key: 'direct', label: 'Post now' })
  })

  // the owner, 9 Sep 2026: "no approval or accept feature, even when the
  // client has that lock" — the manager's button does not move for it
  it('a client who signs every post off does NOT move the manager off the one press', () => {
    const { primary, menu } = footerActions({ status: 'draft', ...manager, clientSignsOff: true })
    expect(primary).toEqual({ key: 'direct', label: 'Schedule' })
    expect(menu.map(m => m.key)).toEqual(['send', 'draft'])
  })

  it('a scheduler on that client sees exactly what they saw before', () => {
    const { primary, menu } = footerActions({ status: 'draft', ...scheduler, clientSignsOff: true })
    expect(primary.label).toBe(SEND_FOR_REVIEW)
    expect(menu.map(m => m.key)).toEqual(['draft'])
  })

  it('an editor is offered no short cut either way', () => {
    for (const clientSignsOff of [false, true]) {
      const { primary, menu } = footerActions({ status: 'draft', ...editor, clientSignsOff })
      expect(primary.key).toBe('send')
      expect(menu.map(m => m.key)).toEqual(['draft'])
    }
  })

  it('"now" is the next couple of minutes, never a time already gone', () => {
    const t = Date.parse('2026-09-05T10:00:00.000Z')
    expect(isPostingNow(new Date(t + 30_000).toISOString(), t)).toBe(true)
    expect(isPostingNow(new Date(t + 119_000).toISOString(), t)).toBe(true)
    expect(isPostingNow(new Date(t + 10 * 60_000).toISOString(), t)).toBe(false)
    // already gone: the composer says so plainly and the button stays disabled
    expect(isPostingNow(new Date(t - 60_000).toISOString(), t)).toBe(false)
    expect(isPostingNow(null, t)).toBe(false)
    expect(isPostingNow('not a time', t)).toBe(false)
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

  it('a post already finished has nothing to press; a booked one can be moved by somebody who may post', () => {
    for (const status of ['published', 'failed', 'cancelled'] as const) {
      expect(footerActions({ status, ...manager }).primary.key).toBe('none')
    }
    // 9 Sep 2026: "I accidentally scheduled it for tomorrow"
    const moved = footerActions({ status: 'scheduled', ...manager })
    expect(moved.primary).toEqual({ key: 'move', label: 'Move to this time' })
    expect(moved.menu.map(m => m.key)).toEqual(['now'])
    expect(footerActions({ status: 'scheduled', mayApprove: false, mayPublish: false }).primary.key).toBe('none')
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


/**
 * THE PER-NETWORK OPTIONS, AS THE WINDOW OFFERS THEM.
 *
 * Two promises. Only the SELECTED network's settings are on screen — a
 * TikTok privacy menu beside an Instagram-only post is a question about
 * nothing. And only settings this POST can carry: a stitch on a set of
 * photographs is a control for something nobody can do.
 */
describe('only the selected network, and only what this post can carry', () => {
  it('shows nothing at all when no channel is chosen', () => {
    expect(moreOptionsFor([])).toEqual([])
    expect(moreOptionsFor(null)).toEqual([])
  })

  it('takes collaborators and the cover picture away where they cannot exist', () => {
    // a Story has no collaborators; a Short has no custom cover picture
    expect(moreOptionsFor(['instagram'], 'story').map(o => o.key)).not.toContain('collaborators')
    expect(moreOptionsFor(['instagram'], 'feed').map(o => o.key)).toContain('collaborators')
    expect(moreOptionsFor(['youtube'], 'reel').map(o => o.key)).not.toContain('ytThumbnail')
    expect(moreOptionsFor(['youtube'], 'feed').map(o => o.key)).toContain('ytThumbnail')
  })

  it('drops the Reel-only settings the moment the post is something else', () => {
    expect(moreOptionsFor(['instagram'], 'carousel').map(o => o.key))
      .not.toContain('trialReel')
    expect(moreOptionsFor(['instagram'], 'reel').map(o => o.key)).toContain('trialReel')
  })

  it('takes stitches off a set of pictures and music off a video', () => {
    const photos = moreOptionsFor(['tiktok'], 'carousel', 'image').map(o => o.key)
    expect(photos).not.toContain('ttStitch')
    expect(photos).toContain('ttMusic')
    const video = moreOptionsFor(['tiktok'], 'reel', 'video').map(o => o.key)
    expect(video).toContain('ttStitch')
    expect(video).not.toContain('ttMusic')
  })

  it('always keeps the TikTok tick, whatever the post is made of', () => {
    for (const lead of ['video', 'image'] as const) {
      expect(moreOptionsFor(['tiktok'], null, lead).map(o => o.key)).toContain('ttConsent')
    }
  })

  it('every row says which field it writes, and it is a real one', () => {
    for (const row of moreOptionsFor(['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin'])) {
      expect(CHANNEL_EXTRA_KEYS, `${row.key} writes a field nothing reads`)
        .toContain(row.field)
    }
  })

  it('groups the rows under the network they belong to', () => {
    const groups = groupOptions(moreOptionsFor(['instagram', 'youtube']))
    // the first comment is on both, so it is not filed under either
    expect(groups[0].platform).toBeNull()
    expect(groups[0].options.map(o => o.key)).toEqual(['firstComment'])
    expect(groups.map(g => g.label)).toEqual(['Every channel that has it', 'Instagram', 'YouTube'])
    expect(groups[1].options.every(o => o.platforms).valueOf()).toBe(true)
  })

  it('does not invent a shared block when one network is on screen', () => {
    const groups = groupOptions(moreOptionsFor(['youtube']))
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('YouTube')
  })
})

describe('what comes back out of the stored blob', () => {
  it('keeps a real choice and drops a word the network has never heard of', () => {
    expect(readChannelExtras({ visibility: 'unlisted' }).visibility).toBe('unlisted')
    expect(readChannelExtras({ visibility: 'secret' }).visibility).toBeUndefined()
    expect(readChannelExtras({ privacyLevel: 'SELF_ONLY' }).privacyLevel).toBe('SELF_ONLY')
    expect(readChannelExtras({ privacyLevel: 'EVERYONE' }).privacyLevel).toBeUndefined()
  })

  it('turns a bare company id into the thing LinkedIn wants, or drops it', () => {
    expect(readChannelExtras({ organizationUrn: '99' }).organizationUrn)
      .toBe('urn:li:organization:99')
    expect(readChannelExtras({ organizationUrn: 'urn:li:organization:99' }).organizationUrn)
      .toBe('urn:li:organization:99')
    expect(readChannelExtras({ organizationUrn: 'Acme Pty Ltd' }).organizationUrn)
      .toBeUndefined()
  })

  it('refuses a place NAME in the box that wants a number', () => {
    expect(readChannelExtras({ locationId: '@thecoffeeplace' }).locationId).toBeUndefined()
    // a pasted id arrives with spaces around it; that is a number, tidied
    expect(readChannelExtras({ locationId: ' 1234567 ' }).locationId).toBe('1234567')
    expect(readChannelExtras({ locationId: '1234567' }).locationId).toBe('1234567')
  })

  it('reads a cover moment as a number and refuses nonsense', () => {
    expect(readChannelExtras({ videoCoverTimestampMs: 2500 }).videoCoverTimestampMs).toBe(2500)
    expect(readChannelExtras({ videoCoverTimestampMs: -1 }).videoCoverTimestampMs).toBeUndefined()
    expect(readChannelExtras({ videoCoverTimestampMs: '2500' }).videoCoverTimestampMs).toBeUndefined()
  })

  it('caps collaborators at three and keeps every tag', () => {
    expect(readChannelExtras({ collaborators: ['@a', 'b', 'c', 'd'] }).collaborators)
      .toEqual(['a', 'b', 'c'])
    expect(readChannelExtras({ tags: ['one', 'two', 'three'] }).tags)
      .toEqual(['one', 'two', 'three'])
  })

  it('sends nothing for a setting somebody emptied again', () => {
    const options = optionsFromExtras({ title: '   ', tags: [], firstComment: 'keep me' })
    expect(options.title).toBeUndefined()
    expect(options.tags).toBeUndefined()
    expect(options.firstComment).toBe('keep me')
  })

  it('keeps a tick box that was deliberately turned OFF', () => {
    // `allowComment: false` is a decision, and an "if (value)" copy would
    // drop it and post with comments on
    expect(optionsFromExtras({ allowComment: false }).allowComment).toBe(false)
    expect(readChannelExtras({ allowComment: false }).allowComment).toBe(false)
  })
})

describe('durationWords', () => {
  it('says the whole limit, half hours included', async () => {
    const { durationWords } = await import('../app/lib/schedule-compose-core')
    expect(durationWords(5400)).toBe('1 hour 30 minutes')
    expect(durationWords(3600)).toBe('1 hour')
    expect(durationWords(600)).toBe('10 minutes')
    expect(durationWords(45)).toBe('45 seconds')
    expect(durationWords(7260)).toBe('2 hours 1 minute')
  })
})

/* ── waiting on somebody else ─────────────────────────────────── */

/**
 * A scheduler who drops their own file on the calendar had the piece moved
 * to `internal_review` (the manager already told) and was then shown "Still
 * being made" in red over that file, under a button `!check.ok` had already
 * disabled. Nothing was wrong and nothing could be pressed.
 */
describe('the window says the calm truth when it is waiting on somebody else', () => {
  it('names the wait, and names the problem sentence it replaces', () => {
    const wait = composerWait({ itemStatus: 'internal_review', mayApprove: false })
    expect(wait?.line).toBe(WAITING_ON_MANAGER)
    expect(WAITING_ON_MANAGER).toMatch(/account manager/)
    expect(WAITING_ON_MANAGER).toMatch(/been told/)
    // the sentence it replaces is validateComposition's own, never a copy
    expect(wait?.replaces).toBe('Still being made')
  })

  it('is not the manager\'s window — they are the person being waited on', () => {
    expect(composerWait({ itemStatus: 'internal_review', mayApprove: true })).toBeNull()
    // …and a client who signs every post off does not change that (the owner,
    // 9 Sep 2026): the lock is a note to the manager, never a wait
    expect(composerWait({ itemStatus: 'internal_review', mayApprove: true, clientSignsOff: true }))
      .toBeNull()
  })

  it('is only this one wait: a piece with the client, or still being made, is said as before', () => {
    for (const status of ['client_review', 'revision_required', 'draft_uploaded', 'approved_for_scheduling']) {
      expect(composerWait({ itemStatus: status, mayApprove: false })).toBeNull()
    }
  })

  it('offers only what is possible: save the draft, and nothing under the arrow', () => {
    const { primary, menu } = footerActions({
      status: 'draft', mayApprove: false, mayPublish: true, waiting: true,
    })
    expect(primary).toEqual({ key: 'draft', label: 'Save as draft' })
    expect(menu).toEqual([])
    // a dead "Send for review" is exactly what it replaces
    expect(primary.label).not.toBe(SEND_FOR_REVIEW)
  })
})

/* ── who signed the media off ────────────────────────────────── */

describe('the badge over the picture says who actually signed it off', () => {
  const at = (over: Partial<Parameters<typeof mediaApprovalBadge>[0]> = {}) => mediaApprovalBadge({
    clientApproved: false, allFromApprovedVersion: true, itemStatus: 'approved_for_scheduling', ...over,
  })

  it('says the client only when the client said yes', () => {
    expect(at({ clientApproved: true })).toEqual({ label: CLIENT_APPROVED_BADGE, tone: 'green' })
    expect(CLIENT_APPROVED_BADGE).toBe('Client approved')
  })

  it('a manager\'s own sign-off says so, and never wears the client\'s name', () => {
    const badge = at({ clientApproved: false })
    expect(badge).toEqual({ label: TEAM_APPROVED_BADGE, tone: 'amber' })
    expect(badge.label).not.toContain('Client')
  })

  it('a piece nobody has signed off is said plainly', () => {
    expect(at({ itemStatus: 'internal_review' }))
      .toEqual({ label: NOT_CLIENT_SIGNED_BADGE, tone: 'amber' })
  })

  it('a file from outside the approved version is covered by no sign-off at all', () => {
    expect(at({ clientApproved: true, allFromApprovedVersion: false }))
      .toEqual({ label: NEW_MEDIA_BADGE, tone: 'amber' })
  })
})


/* ── 8 Sep 2026: the composer must read the same rule the server does ──── */
import { approvalLine as pillLine, footerActions as footer } from '@/app/lib/schedule-compose-core'
import { mayPostWithoutApproval as mayPost } from '@/app/lib/social-schedule-core'

describe('a scheduler on the Schedule page', () => {
  it('gets "Send for approval" as the button — they ask, a manager answers', () => {
    // exactly how NewPostDialog composes it: role -> mayApprove -> footer + pill.
    // Tested as a SCHEDULER on purpose: the super admin path never hits this.
    const mayApprove = mayPost('scheduler', false)
    expect(mayApprove).toBe(false)
    const f = footer({ status: 'draft', mayApprove, mayPublish: true, clientSignsOff: false })
    expect(f.primary.key).toBe('send')
    expect(f.primary.label).toBe('Send for approval')
    expect(f.menu.map(m => m.key)).not.toContain('direct')
    expect(pillLine('draft', { mayApprove, clientSignsOff: false })).toBe('Needs approval before it can post')
  })

  it('a manager gets Schedule, and "yours to post"', () => {
    const mayApprove = mayPost('account_manager', false)
    const f = footer({ status: 'draft', mayApprove, mayPublish: true, clientSignsOff: false })
    expect(f.primary.key).toBe('direct')
    expect(pillLine('draft', { mayApprove, clientSignsOff: false })).toBe('Not sent to anyone — yours to post')
  })
})

/**
 * THE CALENDAR'S DAY, ONE FRAME OF REFERENCE (the owner, 9 Sep 2026: "the
 * calendar cursor on the popup is not showing on the right day"). The
 * picker read react-day-picker's LOCAL-midnight cell with getUTC*, which
 * east of Greenwich is the day before — Melbourne clicked the 15th and
 * booked the 14th. Both directions are local now; whatever zone this test
 * runs in, a key must come back as itself.
 */
describe('the day the calendar hands back is the day that was pressed', () => {
  it('round-trips a key through the Date the calendar draws, in any zone', async () => {
    const { dayKeyToCalendarDate, calendarDateToDayKey } = await import('../app/lib/schedule-compose-core')
    for (const key of ['2026-09-15', '2026-01-01', '2026-12-31', '2026-10-04', '2026-04-05']) {
      const d = dayKeyToCalendarDate(key)!
      // the cell the picker draws for that key: local, and noon so DST cannot move it
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual(key.split('-').map(Number).concat(12))
      expect(calendarDateToDayKey(d)).toBe(key)
      // …and the cell react-day-picker builds itself (local MIDNIGHT) reads back the same
      expect(calendarDateToDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate()))).toBe(key)
    }
  })

  it('refuses a key that is not a day', async () => {
    const { dayKeyToCalendarDate } = await import('../app/lib/schedule-compose-core')
    expect(dayKeyToCalendarDate(null)).toBeUndefined()
    expect(dayKeyToCalendarDate('15/09/2026')).toBeUndefined()
  })
})

/**
 * THE WINDOW THAT FOLLOWS A PRESS (the owner, 9 Sep 2026: "saving as draft
 * doesn't tell the user that it's a draft … once scheduled show a different
 * popup"). One sentence for what happened, one for where it is.
 */
describe('what the page says after a press', () => {
  const at = '2026-09-15T08:30:00.000Z' // 6:30 pm Melbourne

  it('a draft says nothing goes out, and where it sits', async () => {
    const { outcomeWords } = await import('../app/lib/schedule-compose-core')
    const timed = outcomeWords({ kind: 'draft', at, tz: MELB, networks: ['Instagram'] })
    expect(timed.title).toBe('Saved as a draft')
    expect(timed.body).toMatch(/Nothing goes out/)
    expect(timed.body).toMatch(/6:30 pm/)
    expect(timed.showOnCalendar).toBe(true)
    const untimed = outcomeWords({ kind: 'draft', at: null, tz: MELB, networks: [] })
    expect(untimed.body).toMatch(/No time yet/)
    expect(untimed.showOnCalendar).toBe(false)
  })

  it('booked names the time and the networks; sent names the person', async () => {
    const { outcomeWords } = await import('../app/lib/schedule-compose-core')
    const booked = outcomeWords({ kind: 'booked', at, tz: MELB, networks: ['Instagram', 'TikTok'] })
    expect(booked.title).toMatch(/^Booked in for .*6:30 pm/)
    expect(booked.body).toContain('Instagram, TikTok')
    const sent = outcomeWords({ kind: 'sent', at, tz: MELB, networks: ['Instagram'], who: 'Ava' })
    expect(sent.title).toBe('Sent to Ava for approval')
    expect(sent.body).toMatch(/Once they approve it/)
    const now = outcomeWords({ kind: 'now', at, tz: MELB, networks: ['TikTok'] })
    expect(now.title).toBe('Posting now')
    expect(now.body).toContain('TikTok')
  })
})
