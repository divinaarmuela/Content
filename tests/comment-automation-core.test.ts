import { describe, expect, it } from 'vitest'
import {
  NO_POST, accountPostChoice, appPostChoice, campaignOf, chooseBinding, createdAutomationId, dmText, finalLink,
  isAccountWide, mergeChoices, normaliseKeywords, parseAutomationInput, platformIdByPermalink, platformPostIdOn,
  readAccountPosts, readZernioAutomations, shapeLogs, shapeStats, updatePatch, waitingOnOldBooking, withUtm, zernioPayload,
  type AppPostInput,
} from '../app/lib/comment-automation-core'

/**
 * COMMENT-TO-DM AUTOMATIONS, ONE POST EACH (the owner, 29 Sep 2026). The owner's standing rule: nothing
 * messages a prospect on its own except an automation a person deliberately switched on for ONE post.
 */

describe('withUtm — the link gets the four tags', () => {
  const tags = { clientSlug: 'justin-engelke', keyword: 'BOOK' }

  it('adds source, medium, campaign (the client slug) and content (the first keyword, lower-cased)', () => {
    expect(withUtm('https://book.example.com/call', tags)).toEqual({
      ok: true,
      url: 'https://book.example.com/call?utm_source=mdmedia&utm_medium=instagram_dm&utm_campaign=justin_engelke&utm_content=book',
    })
  })

  it('keeps an existing query string exactly as typed, and the #fragment at the end', () => {
    const r = withUtm('https://x.as.me/schedule/4c9e?appointmentType=89708271&name=a%20b#top', tags)
    expect(r).toEqual({
      ok: true,
      url: 'https://x.as.me/schedule/4c9e?appointmentType=89708271&name=a%20b&utm_source=mdmedia&utm_medium=instagram_dm&utm_campaign=justin_engelke&utm_content=book#top',
    })
  })

  it('replaces UTM tags already on the link instead of carrying two campaigns', () => {
    const r = withUtm('https://x.co/?utm_source=old&ref=1&UTM_CAMPAIGN=old', tags)
    expect(r).toEqual({ ok: true, url: 'https://x.co/?ref=1&utm_source=mdmedia&utm_medium=instagram_dm&utm_campaign=justin_engelke&utm_content=book' })
  })

  it('encodes a keyword that is not URL-safe', () => {
    const r = withUtm('https://x.co', { clientSlug: 'a', keyword: 'Free Guide&More' })
    expect(r.ok && r.url).toContain('utm_content=free%20guide%26more')
  })

  it('refuses a link that is not https, not a URL, or has no client slug', () => {
    expect(withUtm('http://x.co', tags)).toMatchObject({ ok: false })
    expect(withUtm('not a link', tags)).toMatchObject({ ok: false })
    expect(withUtm('https://x.co', { clientSlug: '', keyword: 'BOOK' })).toMatchObject({ ok: false })
  })

  it('makes a campaign name out of a slug', () => {
    expect(campaignOf('Justin-Engelke')).toBe('justin_engelke')
    expect(campaignOf('  100m group!! ')).toBe('100m_group')
  })
})

describe('chooseBinding — one post, never the account', () => {
  it('binds a live post by platformPostId alone', () => {
    expect(chooseBinding({ platform_post_id: '18125559040862013', zernio_post_id: '6abb5843c8ba30684174d977', unavailable: null }))
      .toEqual({ ok: true, binding: { kind: 'live', platformPostId: '18125559040862013' } })
  })

  it('binds a booked post by the Zernio post id, which arms on publish', () => {
    expect(chooseBinding({ platform_post_id: null, zernio_post_id: '6abb5843c8ba30684174d977', unavailable: null }))
      .toEqual({ ok: true, binding: { kind: 'pending', postId: '6abb5843c8ba30684174d977' } })
  })

  it('refuses no post at all — there is no account-wide answer', () => {
    expect(chooseBinding(null)).toEqual({ ok: false, error: NO_POST })
    expect(chooseBinding({ platform_post_id: null, zernio_post_id: null, unavailable: null })).toEqual({ ok: false, error: NO_POST })
    expect(chooseBinding({ platform_post_id: '  ', zernio_post_id: '', unavailable: null })).toEqual({ ok: false, error: NO_POST })
  })

  it('refuses a Zernio id that is not one (the docs: platform ids return 400) and a post marked unavailable', () => {
    expect(chooseBinding({ platform_post_id: null, zernio_post_id: 'dry-run-abc', unavailable: null })).toMatchObject({ ok: false })
    expect(chooseBinding({ platform_post_id: '1', zernio_post_id: null, unavailable: 'Not yet' })).toEqual({ ok: false, error: 'Not yet' })
  })
})

describe('zernioPayload', () => {
  const input = { keywords: ['BOOK'], match_mode: 'word' as const, dm_message: 'Hi!', button_title: 'Book a call', comment_reply: 'Sent!' }
  const ids = { profileId: 'p1', accountId: 'a1' }
  const extra = { name: 'n', postTitle: 'Post', link: 'https://x.co/?utm_source=mdmedia' }

  it('a live post sends platformPostId and no postId; the link rides a tracked button', () => {
    const body = zernioPayload(input, ids, { kind: 'live', platformPostId: '181' }, extra)
    expect(body).toMatchObject({
      profileId: 'p1', accountId: 'a1', trigger: 'comment', platformPostId: '181', keywords: ['BOOK'], matchMode: 'word',
      dmMessage: 'Hi!', buttons: [{ type: 'url', title: 'Book a call', url: extra.link }], linkTracking: true, commentReply: 'Sent!',
    })
    expect(body).not.toHaveProperty('postId')
  })

  it('a booked post sends postId and no platformPostId', () => {
    const body = zernioPayload(input, ids, { kind: 'pending', postId: '6abb5843c8ba30684174d977' }, extra)
    expect(body.postId).toBe('6abb5843c8ba30684174d977')
    expect(body).not.toHaveProperty('platformPostId')
  })

  it('with no button the link goes in the DM text, and no buttons are sent', () => {
    const body = zernioPayload({ ...input, button_title: null }, ids, { kind: 'live', platformPostId: '181' }, extra)
    expect(body.dmMessage).toBe(`Hi!\n\n${extra.link}`)
    expect(body).not.toHaveProperty('buttons')
  })

  it('throws rather than build an account-wide body', () => {
    expect(() => zernioPayload(input, ids, null as never, extra)).toThrow(NO_POST)
    expect(() => zernioPayload(input, ids, { kind: 'live', platformPostId: '' }, extra)).toThrow(NO_POST)
  })
})

describe('parseAutomationInput — the form', () => {
  const base = { client_id: 'c1', social_account_id: 's1', post_key: 'app:p1', dm_message: 'Hi' }

  it('defaults the keyword to BOOK and the match to a whole word', () => {
    expect(parseAutomationInput(base)).toMatchObject({ ok: true, value: { keywords: ['BOOK'], match_mode: 'word' } })
  })

  it('says what is missing, in order', () => {
    expect(parseAutomationInput({ ...base, client_id: '' })).toEqual({ ok: false, error: 'Pick the client' })
    expect(parseAutomationInput({ ...base, social_account_id: '' })).toEqual({ ok: false, error: 'Pick the Instagram or Facebook account' })
    expect(parseAutomationInput({ ...base, post_key: '' })).toEqual({ ok: false, error: NO_POST })
    expect(parseAutomationInput({ ...base, dm_message: ' ' })).toEqual({ ok: false, error: 'Write the DM it sends' })
    expect(parseAutomationInput({ ...base, button_title: 'Go' })).toEqual({ ok: false, error: 'The button needs a link' })
    expect(parseAutomationInput({ ...base, button_title: 'x'.repeat(21), link: 'https://x.co' })).toMatchObject({ ok: false })
    expect(parseAutomationInput({ ...base, button_title: 'Go', link: 'https://x.co', dm_message: 'x'.repeat(641) })).toMatchObject({ ok: false })
  })

  it('keywords: comma string, deduped, capped', () => {
    expect(normaliseKeywords('BOOK, book , call')).toEqual(['BOOK', 'call'])
    expect(normaliseKeywords('')).toEqual(['BOOK'])
  })

  it('finalLink checks the DM with the link inside it when there is no button', () => {
    const long = { link: 'https://x.co', keywords: ['BOOK'], dm_message: 'x'.repeat(990), button_title: null }
    expect(finalLink(long, 'a')).toMatchObject({ ok: false })
    expect(finalLink({ ...long, button_title: 'Go', dm_message: 'x' }, 'a')).toMatchObject({ ok: true })
    expect(finalLink({ ...long, link: null }, 'a')).toEqual({ ok: true, link: null })
  })

  it('dmText only appends the link when no button carries it', () => {
    expect(dmText('Hi', 'https://x.co', false)).toBe('Hi\n\nhttps://x.co')
    expect(dmText('Hi', 'https://x.co', true)).toBe('Hi')
    expect(dmText('Hi', null, false)).toBe('Hi')
  })
})

describe('the post list', () => {
  const account = { id: 's1', platform: 'instagram' }
  const post = (over: Partial<AppPostInput> = {}): AppPostInput => ({
    id: 'p1', stage: 'booked', caption: 'Launch day\nmore', scheduled_for: '2026-10-01T09:00:00Z', channels: ['s1'],
    slides: [{ url: 'https://img/1.jpg', type: 'image' }], outcomes: {}, job_ids: ['j1'], ...over,
  })
  const job = { id: 'j1', status: 'scheduled', provider_post_id: '6abb5843c8ba30684174d977', targets: [{ platform: 'instagram' }] }

  it('a booked app post is picked by its Zernio post id', () => {
    const c = appPostChoice(post(), account, [job], null)!
    expect(c).toMatchObject({ key: 'app:p1', state: 'booked', zernio_post_id: job.provider_post_id, platform_post_id: null, title: 'Launch day', thumb: 'https://img/1.jpg', unavailable: null })
    expect(chooseBinding(c)).toMatchObject({ ok: true, binding: { kind: 'pending' } })
  })

  it('a booked post whose job has not reached Zernio cannot be picked yet', () => {
    const c = appPostChoice(post(), account, [{ ...job, status: 'queued', provider_post_id: null }], null)!
    expect(c.unavailable).toMatch(/not reached Zernio/)
    expect(chooseBinding(c).ok).toBe(false)
  })

  it('a posted app post is bound live by the network id the caller resolved', () => {
    const c = appPostChoice(post({ stage: 'posted', outcomes: { instagram: { status: 'published', url: 'https://www.instagram.com/p/X/', at: '2026-09-29T06:19:20Z' } } }), account, [job], '181')!
    expect(c).toMatchObject({ state: 'posted', platform_post_id: '181', date: '2026-09-29T06:19:20Z' })
    expect(chooseBinding(c)).toEqual({ ok: true, binding: { kind: 'live', platformPostId: '181' } })
  })

  it('skips a post not on this account, and a post not booked or posted', () => {
    expect(appPostChoice(post({ channels: ['other'] }), account, [job], null)).toBeNull()
    expect(appPostChoice(post({ stage: 'draft' }), account, [job], null)).toBeNull()
    expect(appPostChoice(post({ stage: 'cancelled' }), account, [job], null)).toBeNull()
  })

  it('reads the account\'s own posts and the network id of a Zernio post (shapes read live 29 Sep 2026)', () => {
    const raw = { status: 'success', posts: [{ id: '181', message: 'Test', createdTime: '2026-09-29T06:19:12.000Z', picture: 'https://p', permalink: 'https://www.instagram.com/p/Dd3GXcAjECp/' }] }
    const list = readAccountPosts(raw)
    expect(list).toEqual([{ id: '181', message: 'Test', createdTime: '2026-09-29T06:19:12.000Z', picture: 'https://p', permalink: 'https://www.instagram.com/p/Dd3GXcAjECp/' }])
    expect(platformIdByPermalink('https://instagram.com/p/Dd3GXcAjECp?igsh=1', list)).toBe('181')
    const zpost = { post: { platforms: [{ platform: 'instagram', accountId: { _id: 'acc1' }, platformPostId: '181', platformPostUrl: 'https://x' }] } }
    expect(platformPostIdOn(zpost, 'acc1')).toEqual({ id: '181', url: 'https://x' })
    expect(platformPostIdOn(zpost, 'other')).toEqual({ id: null, url: null })
  })

  it('merges: the app\'s posts first, then the account\'s posts that are not one of them', () => {
    const app = [appPostChoice(post({ stage: 'posted', outcomes: { instagram: { status: 'published', url: 'https://www.instagram.com/p/A/', at: '2026-09-02' } } }), account, [job], '1')!]
    const acc = [
      { id: '1', message: 'same post', createdTime: '2026-09-02', picture: null, permalink: 'https://www.instagram.com/p/A/' },
      { id: '2', message: 'made on the phone', createdTime: '2026-09-01', picture: null, permalink: 'https://www.instagram.com/p/B/' },
    ]
    const merged = mergeChoices(app, acc)
    expect(merged.map(c => c.key)).toEqual(['app:p1', 'ig:2'])
    expect(accountPostChoice(acc[1])).toMatchObject({ source: 'account', platform_post_id: '2', social_post_id: null })
  })
})

describe('what Zernio says back (shapes read live, 29 Sep 2026)', () => {
  it('reads the created id, the stats and the logs', () => {
    expect(createdAutomationId({ success: true, automation: { id: '6abb' } })).toBe('6abb')
    expect(createdAutomationId({})).toBeNull()
    expect(shapeStats({ triggered: 4, dmsSent: 4, dmsFailed: 1, delivered: 2, read: 2, linkClicks: 3, uniqueClicks: 2 }))
      .toEqual({ triggered: 4, dmsSent: 4, delivered: 2, read: 2, failed: 1, linkClicks: 3, uniqueClicks: 2 })
    const logs = shapeLogs({ logs: [
      { id: 'l1', commenterName: 'a', commentText: 'LINK', status: 'sent', clickCount: 1, createdAt: '2026-09-29T08:00:00Z' },
      { id: 'l2', commenterName: 'b', commentText: 'Link', status: 'skipped', error: 'Already sent DM to this commenter', createdAt: '2026-09-29T09:00:00Z' },
    ] })
    expect(logs.map(l => l.id)).toEqual(['l2', 'l1'])
    expect(logs[0]).toMatchObject({ username: 'b', status: 'skipped', error: 'Already sent DM to this commenter', clicks: 0 })
  })

  it('knows an account-wide automation when it sees one', () => {
    const list = readZernioAutomations({ automations: [
      { id: 'a', accountId: 'x', keywords: ['LINK'], isActive: true, trigger: 'comment' },
      { id: 'b', accountId: 'x', platformPostId: '181', isActive: false, trigger: 'comment' },
    ] })
    expect(list.map(isAccountWide)).toEqual([true, false])
    expect(list[1].isActive).toBe(false)
  })

  it('flags an automation waiting on a booking that was replaced', () => {
    const row = { zernio_post_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', platform_post_id: null }
    expect(waitingOnOldBooking(row, { stage: 'booked', zernio_ids: ['bbbbbbbbbbbbbbbbbbbbbbbb'] })).toBe(true)
    expect(waitingOnOldBooking(row, { stage: 'booked', zernio_ids: ['aaaaaaaaaaaaaaaaaaaaaaaa'] })).toBe(false)
    expect(waitingOnOldBooking(row, { stage: 'posted', zernio_ids: [] })).toBe(false)
  })

  it('updatePatch passes only known fields and keeps the link in the text', () => {
    expect(updatePatch({ active: false, evil: 1 })).toEqual({ ok: true, patch: { isActive: false }, ours: { active: false, paused_reason: null } })
    expect(updatePatch({ dm_message: 'New' }, { link: 'https://x.co', hasButton: false }))
      .toMatchObject({ ok: true, patch: { dmMessage: 'New\n\nhttps://x.co' }, ours: { dm_message: 'New' } })
    expect(updatePatch({})).toEqual({ ok: false, error: 'Nothing to change' })
    expect(updatePatch({ dm_message: '' })).toMatchObject({ ok: false })
  })
})
