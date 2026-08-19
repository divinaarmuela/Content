import { describe, expect, it } from 'vitest'
import {
  automationPayload, normaliseKeywords, parseAutomationDraft,
} from '../app/lib/automation-core'

describe('normaliseKeywords', () => {
  it('accepts a comma string, trims, dedupes case-insensitively', () => {
    expect(normaliseKeywords('LINK, link ,  price,, ')).toEqual(['LINK', 'price'])
  })
  it('accepts an array and caps the count', () => {
    expect(normaliseKeywords(Array.from({ length: 30 }, (_, i) => `k${i}`)).length).toBe(20)
  })
  it('handles junk', () => {
    expect(normaliseKeywords(null)).toEqual([])
    expect(normaliseKeywords(42)).toEqual([])
  })
})

describe('parseAutomationDraft', () => {
  const base = { name: 'Launch', keywords: 'LINK', dmMessage: 'Here you go' }

  it('accepts a minimal valid draft with the comment trigger by default', () => {
    const r = parseAutomationDraft(base)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.trigger).toBe('comment')
      expect(r.value.keywords).toEqual(['LINK'])
      expect(r.value.alsoMatchInDms).toBe(false)
    }
  })

  it('rejects a missing name, keywords, or message with a specific reason', () => {
    expect(parseAutomationDraft({ ...base, name: ' ' })).toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, keywords: '' })).toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, dmMessage: '' })).toMatchObject({ ok: false })
  })

  it('requires the button to be complete and https', () => {
    expect(parseAutomationDraft({ ...base, buttonTitle: 'Shop' })).toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, buttonUrl: 'https://x.co' })).toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, buttonTitle: 'Shop', buttonUrl: 'http://x.co' }))
      .toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, buttonTitle: 'Shop', buttonUrl: 'not a url' }))
      .toMatchObject({ ok: false })
    const ok = parseAutomationDraft({ ...base, buttonTitle: 'Shop', buttonUrl: 'https://x.co' })
    expect(ok.ok).toBe(true)
  })

  it('enforces the 640-char cap only when a button rides along', () => {
    const long = 'x'.repeat(700)
    expect(parseAutomationDraft({ ...base, dmMessage: long }).ok).toBe(true)
    expect(parseAutomationDraft({
      ...base, dmMessage: long, buttonTitle: 'Go', buttonUrl: 'https://x.co',
    })).toMatchObject({ ok: false })
    expect(parseAutomationDraft({ ...base, dmMessage: 'x'.repeat(1100) })).toMatchObject({ ok: false })
  })

  it('keeps story_reply and post scoping when given', () => {
    const r = parseAutomationDraft({ ...base, trigger: 'story_reply', platformPostId: ' 123 ' })
    expect(r).toMatchObject({ ok: true, value: { trigger: 'story_reply', platformPostId: '123' } })
  })
})

describe('automationPayload', () => {
  it('builds the provider body with ids and only the fields that are set', () => {
    const draft = parseAutomationDraft({
      name: 'Launch', keywords: 'LINK', dmMessage: 'Here',
      buttonTitle: 'Shop', buttonUrl: 'https://x.co', alsoMatchInDms: true,
    })
    expect(draft.ok).toBe(true)
    if (!draft.ok) return
    const p = automationPayload(draft.value, { profileId: 'p1', accountId: 'a1' })
    expect(p).toEqual({
      profileId: 'p1', accountId: 'a1', name: 'Launch', trigger: 'comment',
      keywords: ['LINK'], dmMessage: 'Here', alsoMatchInDms: true,
      buttons: [{ type: 'url', title: 'Shop', url: 'https://x.co' }],
    })
  })
})
