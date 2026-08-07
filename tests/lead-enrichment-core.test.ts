import { describe, it, expect } from 'vitest'
import {
  emailDomain, isBusinessDomain, slugify, FREE_MAIL_DOMAINS,
  companyKey, isSameCompany, matchExistingCompany,
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

describe('companyKey', () => {
  it('strips legal suffixes, a leading "the", and punctuation', () => {
    expect(companyKey('The Emerald Reception Pty Ltd')).toBe('emerald reception')
    expect(companyKey('Turnkey Building Group')).toBe('turnkey building')
    expect(companyKey('Smith & Sons, Inc.')).toBe('smith and sons')
  })

  it('treats a plural and a singular as the same business', () => {
    expect(companyKey('Emerald Receptions')).toBe(companyKey('Emerald Reception'))
  })

  it('returns empty for nothing usable', () => {
    expect(companyKey('  ')).toBe('')
    expect(companyKey('Pty Ltd')).toBe('')
  })
})

describe('isSameCompany', () => {
  it('matches the same business written differently', () => {
    expect(isSameCompany('The Emerald Reception Pty Ltd', 'Emerald Receptions')).toBe(true)
    expect(isSameCompany('TURNKEY BUILDING GROUP', 'Turnkey Building')).toBe(true)
  })

  it('matches a name written without spaces, as domains give it', () => {
    expect(isSameCompany('RealDeal', 'Real Deal')).toBe(true)
    expect(isSameCompany('turnkeybuilding', 'Turnkey Building Group')).toBe(true)
  })

  it('does not let one word swallow a longer name', () => {
    // a lead from "Emerald" should not be discarded because "Emerald Reception"
    // is a client — that is a different business until proven otherwise
    expect(isSameCompany('Emerald', 'Emerald Reception')).toBe(false)
  })

  it('requires a whole-prefix match, not a shared first word', () => {
    expect(isSameCompany('Turnkey Plumbing', 'Turnkey Building')).toBe(false)
  })

  it('is false when either side is empty', () => {
    expect(isSameCompany('', 'Emerald')).toBe(false)
    expect(isSameCompany('Pty Ltd', 'Emerald')).toBe(false)
  })
})

describe('matchExistingCompany', () => {
  it('returns the stored name it matched, so the log can say which', () => {
    expect(matchExistingCompany('emerald receptions pty ltd', ['Pattons', 'The Emerald Reception']))
      .toBe('The Emerald Reception')
  })

  it('returns null when nothing matches', () => {
    expect(matchExistingCompany('Brand New Co', ['Pattons', 'Cecconis'])).toBe(null)
  })
})
