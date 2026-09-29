import { describe, expect, it } from 'vitest'
import {
  CANCELLED_REASON, MAX_VARIATIONS, NO_AUTOMATION, TAKEN_OFF_REASON, armDecision, automationLine, parseAutomationInput,
  postAutomationProblem, readPostAutomation, readVariations, updatePatch, zernioPayload,
} from '../app/lib/comment-automation-core'

/**
 * THE AUTOMATION SET UP WHILE SCHEDULING (the owner, 29 Sep 2026: "ManyChat-style"), and the other DM
 * texts / other public replies (Zernio's dmMessageVariations / commentReplyVariations, OpenAPI v1.151.0).
 */

describe('variations — other DM texts and other public replies', () => {
  const base = { client_id: 'c1', social_account_id: 's1', post_key: 'app:p1', dm_message: 'Hi', comment_reply: 'Sent!' }

  it('reads one per line or an array, drops blanks, repeats and a repeat of the main text', () => {
    expect(readVariations('Hey\n\n hey \nHi\nYo', { what: 'DM texts', max: 1000, main: 'Hi' })).toEqual({ ok: true, list: ['Hey', 'Yo'] })
    expect(readVariations(['a', '', 'b'], { what: 'x', max: 10 })).toEqual({ ok: true, list: ['a', 'b'] })
    expect(readVariations(undefined, { what: 'x', max: 10 })).toEqual({ ok: true, list: [] })
  })

  it(`refuses more than ${MAX_VARIATIONS}, and one too long`, () => {
    expect(readVariations('1\n2\n3\n4\n5', { what: 'DM texts', max: 10 })).toMatchObject({ ok: false })
    expect(readVariations(['x'.repeat(11)], { what: 'DM texts', max: 10 })).toMatchObject({ ok: false })
  })

  it('the form: other replies need the main reply; a DM variation with a button is held to 640', () => {
    expect(parseAutomationInput({ ...base, comment_reply: '', reply_variations: 'Check DMs' }))
      .toEqual({ ok: false, error: 'Write the public reply first — the other replies are picked at random with it' })
    expect(parseAutomationInput({ ...base, button_title: 'Go', link: 'https://x.co', dm_variations: ['x'.repeat(641)] })).toMatchObject({ ok: false })
    expect(parseAutomationInput({ ...base, dm_variations: 'Hey\nYo', reply_variations: 'On its way' }))
      .toMatchObject({ ok: true, value: { dm_variations: ['Hey', 'Yo'], reply_variations: ['On its way'] } })
  })

  it('zernioPayload sends dmMessageVariations (with the link, when no button) and commentReplyVariations', () => {
    const body = zernioPayload(
      { keywords: ['BOOK'], match_mode: 'word', dm_message: 'Hi', button_title: null, comment_reply: 'Sent!', dm_variations: ['Hey'], reply_variations: ['Check DMs'] },
      { profileId: 'p', accountId: 'a' }, { kind: 'live', platformPostId: '1' }, { name: 'n', postTitle: 't', link: 'https://x.co' })
    expect(body.dmMessageVariations).toEqual(['Hey\n\nhttps://x.co'])
    expect(body.commentReplyVariations).toEqual(['Check DMs'])
    const none = zernioPayload({ keywords: ['BOOK'], match_mode: 'word', dm_message: 'Hi', button_title: null, comment_reply: null },
      { profileId: 'p', accountId: 'a' }, { kind: 'live', platformPostId: '1' }, { name: 'n', postTitle: 't', link: null })
    expect(none).not.toHaveProperty('dmMessageVariations')
    expect(none).not.toHaveProperty('commentReplyVariations')
  })

  it('updatePatch sends them, and [] clears them', () => {
    expect(updatePatch({ dm_variations: [] })).toMatchObject({ ok: true, patch: { dmMessageVariations: [] } })
    expect(updatePatch({ reply_variations: 'A\nB' })).toMatchObject({ ok: true, patch: { commentReplyVariations: ['A', 'B'] } })
    expect(updatePatch({ reply_variations: '1\n2\n3\n4\n5' })).toMatchObject({ ok: false })
  })
})

describe('the post\'s own automation', () => {
  const on = {
    on: true, keywords: ['BOOK'], dm_message: 'Hi', button_title: 'Book a call', link: 'https://x.co', comment_reply: null,
    dm_variations: [] as string[], reply_variations: [] as string[],
  }

  it('reads what is stored, and nothing when nothing was ever written', () => {
    expect(readPostAutomation(on)).toEqual(on)
    expect(readPostAutomation(null)).toBeNull()
    expect(readPostAutomation({ on: false, dm_message: '' })).toBeNull()
    expect(readPostAutomation({ on: true })).toMatchObject({ on: true, keywords: ['BOOK'], dm_message: '' })
    expect(NO_AUTOMATION.on).toBe(false)
  })

  it('is checked only when switched on', () => {
    expect(postAutomationProblem({ ...on, on: false, dm_message: '' }, 'a')).toBeNull()
    expect(postAutomationProblem({ ...on, dm_message: '' }, 'a')).toBe('Automation: Write the DM it sends')
    expect(postAutomationProblem({ ...on, link: 'http://x.co' }, null)).toMatch(/https/)
    expect(postAutomationProblem(on, 'a')).toBeNull()
  })

  it('armDecision: create once, re-activate what the app switched off, rebind a new booking, never undo a person', () => {
    const pending = { kind: 'pending' as const, postId: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
    const row = { zernio_post_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', platform_post_id: null, active: true, paused_reason: null }
    expect(armDecision(null, pending)).toBe('create')
    expect(armDecision(row, pending)).toBe('none')
    expect(armDecision({ ...row, active: false, paused_reason: TAKEN_OFF_REASON }, pending)).toBe('reactivate')
    expect(armDecision({ ...row, active: false, paused_reason: CANCELLED_REASON }, pending)).toBe('reactivate')
    expect(armDecision({ ...row, active: false, paused_reason: null }, pending)).toBe('none')
    expect(armDecision(row, { kind: 'pending', postId: 'bbbbbbbbbbbbbbbbbbbbbbbb' })).toBe('rebind')
    // armed on the pending booking and now the post is live: Zernio armed it itself
    expect(armDecision(row, { kind: 'live', platformPostId: '181' })).toBe('none')
  })

  it('the card line', () => {
    expect(automationLine(on, { made: true, active: true, live: false, stats: null })).toBe('Automation: BOOK → DM with link · waiting for the post')
    expect(automationLine(on, { made: true, active: true, live: true, stats: { dmsSent: 12, linkClicks: 5 } }))
      .toBe('Automation: BOOK → DM with link · live · 12 DMs, 5 clicks')
    expect(automationLine({ ...on, link: null }, null)).toBe('Automation: BOOK → DM · starts when the post is booked')
    expect(automationLine({ ...on, on: false }, null)).toBe('Automation: BOOK → DM with link · off')
    expect(automationLine(null, null)).toBeNull()
  })
})
