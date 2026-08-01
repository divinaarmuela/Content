import { describe, it, expect } from 'vitest'
import {
  decodeBase64Url, header, parseFromHeader, extractBody, stripHtml, prefilterSkipReason,
} from '../app/lib/gmail-core'

const b64url = (s: string) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

describe('decodeBase64Url', () => {
  it('round-trips gmail-style base64url including url-unsafe bytes', () => {
    const text = 'G’day — we need content? sure/maybe+ok'
    expect(decodeBase64Url(b64url(text))).toBe(text)
  })
})

describe('parseFromHeader', () => {
  it('parses name + address forms', () => {
    expect(parseFromHeader('Jane Doe <Jane@Pattons.com.au>')).toEqual({ name: 'Jane Doe', email: 'jane@pattons.com.au' })
    expect(parseFromHeader('"Doe, Jane" <j@x.co>').email).toBe('j@x.co')
  })
  it('handles bare addresses', () => {
    expect(parseFromHeader('  BOB@x.co ')).toEqual({ name: '', email: 'bob@x.co' })
  })
})

describe('header', () => {
  it('is case-insensitive and safe on undefined', () => {
    const hs = [{ name: 'Subject', value: 'Hi' }]
    expect(header(hs, 'subject')).toBe('Hi')
    expect(header(undefined, 'subject')).toBe('')
  })
})

describe('extractBody', () => {
  it('prefers text/plain in a multipart tree', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>HTML version</p>') } },
        { mimeType: 'text/plain', body: { data: b64url('Plain version') } },
      ],
    }
    expect(extractBody(payload)).toBe('Plain version')
  })
  it('falls back to stripped html', () => {
    const payload = { mimeType: 'text/html', body: { data: b64url('<div>Hello<br>there &amp; welcome</div>') } }
    expect(extractBody(payload)).toBe('Hello\nthere & welcome')
  })
  it('returns empty for empty payloads', () => {
    expect(extractBody({})).toBe('')
  })
})

describe('stripHtml', () => {
  it('removes style/script and decodes entities', () => {
    const html = '<style>.x{color:red}</style><p>Price &gt; $5 &quot;deal&quot;</p><script>x()</script>'
    expect(stripHtml(html)).toBe('Price > $5 "deal"')
  })
})

describe('prefilterSkipReason', () => {
  const base = { subject: 'Enquiry', ownDomain: 'mdmmarketing.com.au' }
  it('lets a plausible enquiry through', () => {
    expect(prefilterSkipReason({ ...base, fromEmail: 'jane@pattons.com.au' })).toBeNull()
  })
  it('skips internal, no-reply, bulk, and auto-submitted mail', () => {
    expect(prefilterSkipReason({ ...base, fromEmail: 'contact@mdmmarketing.com.au' })).toBe('internal sender')
    expect(prefilterSkipReason({ ...base, fromEmail: 'no-reply@stripe.com' })).toBe('no-reply sender')
    expect(prefilterSkipReason({ ...base, fromEmail: 'news@x.co', listUnsubscribe: '<mailto:u@x.co>' })).toBe('bulk/newsletter')
    expect(prefilterSkipReason({ ...base, fromEmail: 'bot@x.co', autoSubmitted: 'auto-generated' })).toBe('auto-submitted')
  })
  it('auto-submitted: no is not a skip', () => {
    expect(prefilterSkipReason({ ...base, fromEmail: 'jane@x.co', autoSubmitted: 'no' })).toBeNull()
  })
})
