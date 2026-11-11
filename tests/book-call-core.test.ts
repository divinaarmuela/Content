import { describe, expect, it } from 'vitest'
import { bookCallHref, calendlyEmbedUrl, cleanFrom, withFrom, CALENDLY_CALL_URL } from '../app/lib/book-call-core'

describe('/book-call links and the embedded calendar', () => {
  it('buttons link to the page with their tag', () => {
    expect(bookCallHref('mdnav')).toBe('/book-call?cta=mdnav')
    expect(bookCallHref()).toBe('/book-call')
  })

  it('without an ad: the button tag, and the page they came from as salesforce_uuid', () => {
    const u = new URL(calendlyEmbedUrl({ utm: {}, from: '/services/strategy', cta: 'mdnav' }))
    expect(u.origin + u.pathname).toBe(CALENDLY_CALL_URL)
    expect(u.searchParams.get('utm_source')).toBe('website')
    expect(u.searchParams.get('utm_medium')).toBe('book-a-call')
    expect(u.searchParams.get('utm_campaign')).toBe('mdnav')
    expect(u.searchParams.get('salesforce_uuid')).toBe('/services/strategy')
  })

  it('an ad\'s tags win over the button tag', () => {
    const u = new URL(calendlyEmbedUrl({ utm: { utm_source: 'fb', utm_campaign: 'Nov leads' }, from: '/', cta: 'mdnav' }))
    expect(u.searchParams.get('utm_source')).toBe('fb')
    expect(u.searchParams.get('utm_campaign')).toBe('Nov leads')
    expect(u.searchParams.get('utm_medium')).toBeNull()
  })

  it('spaces travel as %20, never "+" (Calendly\'s widget turned "+" into a literal plus, 11 Nov 2026)', () => {
    const raw = calendlyEmbedUrl({ utm: { utm_campaign: 'Nov Leads', utm_content: 'BTS video ad' } })
    expect(raw).toContain('utm_campaign=Nov%20Leads')
    expect(raw).toContain('utm_content=BTS%20video%20ad')
    expect(raw).not.toContain('+')
  })

  it('step 1 prefills Calendly with the same name and email', () => {
    const raw = calendlyEmbedUrl({ utm: {}, prefill: { name: 'Ana Lee', email: 'ana@venue.com' } })
    expect(raw).toContain('name=Ana%20Lee')
    expect(raw).toContain('email=ana%40venue.com')
    expect(calendlyEmbedUrl({ utm: {} })).not.toContain('email=')
  })

  it('from is only ever one of our own paths', () => {
    expect(cleanFrom('https://evil.example')).toBeNull()
    expect(cleanFrom('//evil.example')).toBeNull()
    expect(cleanFrom('/work')).toBe('/work')
  })

  it('a click adds the page once; other links are left alone', () => {
    const o = 'https://www.mdmmarketing.com.au'
    expect(withFrom('/book-call?cta=mdnav', o, '/about')).toBe('/book-call?cta=mdnav&from=%2Fabout')
    expect(withFrom('/book-call?from=%2Fwork', o, '/about')).toBe('/book-call?from=%2Fwork')
    expect(withFrom('/work', o, '/about')).toBe('/work')
    expect(withFrom('https://calendly.com/x', o, '/about')).toBe('https://calendly.com/x')
  })
})
