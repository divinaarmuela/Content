import { describe, it, expect } from 'vitest'
import {
  emailDomain, isBusinessDomain, slugify, FREE_MAIL_DOMAINS,
} from '../app/lib/lead-enrichment-core'

describe('emailDomain', () => {
  it('extracts and lowercases', () => {
    expect(emailDomain('Jane@Pattons.COM.AU')).toBe('pattons.com.au')
    expect(emailDomain('  x@y.co ')).toBe('y.co')
  })
  it('rejects malformed addresses', () => {
    expect(emailDomain('not-an-email')).toBeNull()
    expect(emailDomain('a@b')).toBeNull()
    expect(emailDomain('a b@c.com')).toBeNull()
    expect(emailDomain('')).toBeNull()
  })
})

describe('isBusinessDomain', () => {
  it('flags real business domains', () => {
    expect(isBusinessDomain('pattons.com.au')).toBe(true)
    expect(isBusinessDomain('mdmmarketing.com.au')).toBe(true)
  })
  it('rejects free-mail providers including AU ISPs', () => {
    for (const d of ['gmail.com', 'hotmail.com.au', 'bigpond.com', 'icloud.com', 'proton.me']) {
      expect(isBusinessDomain(d)).toBe(false)
    }
  })
  it('the free-mail list itself is all lowercase (lookup correctness)', () => {
    for (const d of FREE_MAIL_DOMAINS) expect(d).toBe(d.toLowerCase())
  })
})

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify("Cecconi's Toorak & Flinders")).toBe('cecconi-s-toorak-flinders')
    expect(slugify('  Pattons  ')).toBe('pattons')
  })
  it('returns empty for junk', () => {
    expect(slugify('!!!')).toBe('')
    expect(slugify('')).toBe('')
  })
})
