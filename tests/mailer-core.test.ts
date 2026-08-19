import { describe, it, expect } from 'vitest'
import { actorAlias, senderName, fromHeader, replyToFor } from '../app/lib/mailer-core'

describe('senderName — the email reads as from the person who acted', () => {
  it('names the actor with the brand', () => {
    expect(senderName('Manal Rizwan')).toBe('Manal Rizwan · MD Media')
  })

  it('falls back to the brand when nobody acted', () => {
    expect(senderName(undefined)).toBe('MD Media')
    expect(senderName(null)).toBe('MD Media')
    expect(senderName('   ')).toBe('MD Media')
  })

  it('strips header-breaking characters rather than escaping them', () => {
    expect(senderName('Evil"<x@y.z>\r\nBcc: victim')).toBe('Evilx@y.zBcc: victim · MD Media')
    expect(senderName('"""')).toBe('MD Media')
  })

  it('caps absurdly long names', () => {
    expect(senderName('a'.repeat(200)).length).toBeLessThanOrEqual(60 + ' · MD Media'.length)
  })
})

describe('fromHeader', () => {
  it('builds a full RFC 5322 mailbox', () => {
    expect(fromHeader('hello@mdmmarketing.com.au', 'Renee Yap'))
      .toBe('Renee Yap · MD Media <hello@mdmmarketing.com.au>')
  })
})

describe('actorAlias — everyone gets a sender identity on our domain', () => {
  const D = 'mdmmarketing.com.au'

  it('a work address IS the identity — used as-is', () => {
    expect(actorAlias(D, 'Tech MD', 'tech@mdmmarketing.com.au')).toBe('tech@mdmmarketing.com.au')
    expect(actorAlias(D, 'Tech MD', 'Tech@MDMMarketing.com.au')).toBe('tech@mdmmarketing.com.au')
  })

  it('a personal Gmail gets a stable alias from their name', () => {
    expect(actorAlias(D, 'Manal Rizwan', 'manalrizwann@gmail.com')).toBe('manal.rizwan@mdmmarketing.com.au')
    expect(actorAlias(D, 'Karly Merau', 'karly.merau.99@gmail.com')).toBe('karly.merau@mdmmarketing.com.au')
  })

  it('diacritics and punctuation flatten to a clean local part', () => {
    expect(actorAlias(D, 'Sebastián Pulgarin', 'esevisualstudio@gmail.com'))
      .toBe('sebastian.pulgarin@mdmmarketing.com.au')
    expect(actorAlias(D, "  O'Neil-Smith,  Jr. ", 'x@y.com')).toBe('o.neil.smith.jr@mdmmarketing.com.au')
  })

  it('no name falls back to the email local part; nothing usable → null', () => {
    expect(actorAlias(D, null, 'rainarao234@gmail.com')).toBe('rainarao234@mdmmarketing.com.au')
    expect(actorAlias(D, null, null)).toBeNull()
    expect(actorAlias('', 'Someone', 'a@b.c')).toBeNull()
  })
})

describe('replyToFor — replies go to the actor, never nowhere', () => {
  it('returns the actor address', () => {
    expect(replyToFor('renee@example.com', 'hello@mdmmarketing.com.au')).toBe('renee@example.com')
  })

  it('is omitted when the actor IS the transport address', () => {
    expect(replyToFor('hello@mdmmarketing.com.au', 'hello@mdmmarketing.com.au')).toBeUndefined()
    expect(replyToFor('HELLO@mdmmarketing.com.au', 'hello@mdmmarketing.com.au')).toBeUndefined()
  })

  it('is omitted for missing, rubbish, or test addresses', () => {
    expect(replyToFor(undefined, 'hello@x.com')).toBeUndefined()
    expect(replyToFor('not-an-email', 'hello@x.com')).toBeUndefined()
    expect(replyToFor('test-am@mdmedia-test.invalid', 'hello@x.com')).toBeUndefined()
  })
})
