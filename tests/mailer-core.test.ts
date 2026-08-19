import { describe, it, expect } from 'vitest'
import { senderName, fromHeader, replyToFor } from '../app/lib/mailer-core'

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
