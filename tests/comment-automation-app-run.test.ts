import { describe, expect, it } from 'vitest'
import {
  appLogs, appSendDecision, appStats, keywordMatches, parseAutomationInput, pickText, runnerOf, sendKey, type AppRunRow,
} from '../app/lib/comment-automation-core'

// OUR APP'S OWN AUTOMATIONS (the owner, 30 Sep 2026: "we have a comment trigger … and then we send")

const row = (over: Partial<AppRunRow> = {}): AppRunRow => ({
  id: 'auto1', runner: 'app', active: true, provider_account_id: 'acc1', platform_post_id: 'post1',
  keywords: ['RBA'], match_mode: 'word', comment_reply: 'Thanks! Check your DM', reply_variations: ['Link sent to your DM'],
  ...over,
})
const comment = (over: Record<string, unknown> = {}) => ({
  commentId: 'c1', accountId: 'acc1', platformPostId: 'post1', text: 'RBA', authorId: '4314278915456570', authorUsername: 'yusuf', ...over,
})

describe('keywordMatches — the same reading as Zernio’s matchMode', () => {
  it('word: the keyword on its own, any case, with punctuation around it', () => {
    for (const t of ['RBA', 'rba', 'Rba', 'rba!', 'yes RBA please', '@jordan RBA']) expect(keywordMatches(t, ['RBA'], 'word')).toBe(true)
  })
  it('word: never inside another word', () => {
    for (const t of ['carbage', 'rbas', 'xrba']) expect(keywordMatches(t, ['RBA'], 'word')).toBe(false)
  })
  it('contains matches inside a word; exact wants the whole comment', () => {
    expect(keywordMatches('carbage', ['rba'], 'contains')).toBe(true)
    expect(keywordMatches('rba please', ['RBA'], 'exact')).toBe(false)
    expect(keywordMatches('  rba ', ['RBA'], 'exact')).toBe(true)
  })
  it('a keyword with regex characters is taken literally', () => {
    expect(keywordMatches('I want c++ info', ['c++'], 'contains')).toBe(true)
    expect(keywordMatches('cxx', ['c.x'], 'contains')).toBe(false)
  })
  it('an empty comment never matches', () => {
    expect(keywordMatches('   ', ['RBA'], 'word')).toBe(false)
  })
})

describe('appSendDecision — whether our app answers this comment', () => {
  it('answers a keyword comment on its own post and account, naming the person by their id', () => {
    expect(appSendDecision(row(), comment())).toEqual({ send: true, person: '4314278915456570' })
  })
  it('falls back to the username when the comment gives no id', () => {
    expect(appSendDecision(row(), comment({ authorId: undefined }))).toEqual({ send: true, person: 'yusuf' })
  })
  it('never answers for Zernio’s automations, a switched-off one, another post or account', () => {
    expect(appSendDecision(row({ runner: null }), comment()).send).toBe(false)
    expect(appSendDecision(row({ active: false }), comment()).send).toBe(false)
    expect(appSendDecision(row(), comment({ platformPostId: 'post2' })).send).toBe(false)
    expect(appSendDecision(row(), comment({ accountId: 'acc2' })).send).toBe(false)
  })
  it('never answers itself: an own comment, or one that is word for word one of its public replies', () => {
    expect(appSendDecision(row(), comment({ own: true })).send).toBe(false)
    // our reply contains no keyword here, but a reply that did must still be skipped
    expect(appSendDecision(row({ keywords: ['DM'] }), comment({ text: 'Link sent to your DM' }))).toEqual({ send: false, reason: 'our own reply' })
  })
  it('skips a comment without the keyword, or one that names nobody', () => {
    expect(appSendDecision(row(), comment({ text: 'Great Jordan 👏' }))).toEqual({ send: false, reason: 'no keyword' })
    expect(appSendDecision(row(), comment({ authorId: undefined, authorUsername: undefined })).send).toBe(false)
  })
})

describe('sendKey — one DM per person per automation', () => {
  it('is the same for the same person however their name is written', () => {
    expect(sendKey('auto1', '@Yusuf')).toBe(sendKey('auto1', 'yusuf'))
  })
  it('is a legal database key even for a handle with dots', () => {
    expect(sendKey('auto1', 'yusuf.munshi.52035')).not.toMatch(/[.#$[\]/]/)
  })
  it('differs per automation', () => {
    expect(sendKey('auto1', 'yusuf')).not.toBe(sendKey('auto2', 'yusuf'))
  })
})

describe('pickText', () => {
  it('always picks the same text for the same seed, and only from the texts given', () => {
    const a = pickText('one', ['two', 'three'], 'comment-42')
    expect(pickText('one', ['two', 'three'], 'comment-42')).toBe(a)
    expect(['one', 'two', 'three']).toContain(a)
  })
  it('with no others, it is the main text', () => {
    expect(pickText('only', [], 'x')).toBe('only')
  })
})

describe('the list for our app’s sends', () => {
  const sends = [
    { id: 's1', status: 'sent', commenter: '4314278915456570', commenter_name: 'yusuf.munshi.52035', comment_text: 'RBA', error: null, created_at: '2026-09-30T02:00:00Z' },
    { id: 's2', status: 'failed', commenter: 'ana', commenter_name: null, comment_text: 'rba', error: 'Instagram: reply window closed', created_at: '2026-09-30T03:00:00Z' },
  ]
  it('counts what went and what failed', () => {
    expect(appStats(sends)).toMatchObject({ triggered: 2, dmsSent: 1, failed: 1 })
  })
  it('lists newest first, by name rather than a number, with the reason for a failure', () => {
    const logs = appLogs(sends)
    expect(logs.map(l => l.id)).toEqual(['s2', 's1'])
    expect(logs[1].username).toBe('yusuf.munshi.52035')
    expect(logs[0].error).toBe('Instagram: reply window closed')
  })
})

describe('parseAutomationInput — who runs it', () => {
  const base = { client_id: 'c', social_account_id: 'a', post_key: 'ig:1', dm_message: 'Hi' }
  it('is Zernio unless our app is asked for', () => {
    const z = parseAutomationInput(base)
    const a = parseAutomationInput({ ...base, runner: 'app' })
    expect(z.ok && z.value.runner).toBe('zernio')
    expect(a.ok && a.value.runner).toBe('app')
  })
  it('an old row with no runner is Zernio’s', () => {
    expect(runnerOf({})).toBe('zernio')
    expect(runnerOf({ runner: 'app' })).toBe('app')
  })
})
