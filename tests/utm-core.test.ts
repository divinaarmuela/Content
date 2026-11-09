import { describe, it, expect } from 'vitest'
import { utmFrom, withUtm } from '@/app/lib/utm-core'

const CAL = 'https://calendly.com/mdmmarketing-info/call?utm_source=website&utm_medium=book-a-call&utm_campaign=hero'

describe('utm passthrough', () => {
  it('reads only utm tags', () => {
    expect(utmFrom('?utm_source=facebook&utm_campaign=nov&fbclid=x')).toEqual({ utm_source: 'facebook', utm_campaign: 'nov' })
    expect(utmFrom('')).toEqual({})
  })
  it('ad tags replace the link defaults, others kept', () => {
    const u = new URL(withUtm(CAL, { utm_source: 'facebook', utm_campaign: 'nov-ad' }))
    expect(u.searchParams.get('utm_source')).toBe('facebook')
    expect(u.searchParams.get('utm_campaign')).toBe('nov-ad')
    expect(u.searchParams.get('utm_medium')).toBe('book-a-call')
  })
  it('leaves non-Calendly links and empty tags alone', () => {
    expect(withUtm('https://evil.com/calendly.com', { utm_source: 'fb' })).toBe('https://evil.com/calendly.com')
    expect(withUtm(CAL, {})).toBe(CAL)
  })
})

import { adFieldsFromUtm } from '@/app/lib/utm-core'
describe('form ad fields', () => {
  it('maps an ad visit to columns, ignores our own links and junk', () => {
    expect(adFieldsFromUtm({ utm_source: 'ig', utm_medium: 'Instagram_Stories', utm_campaign: 'Nov', utm_term: 'Set A', utm_content: 'Ad 1' }))
      .toEqual({ source_tag: 'Nov', ad_campaign: 'Nov', ad_set: 'Set A', ad_name: 'Ad 1', ad_placement: 'Instagram_Stories' })
    expect(adFieldsFromUtm({ utm_source: 'website', utm_campaign: 'hero' })).toEqual({})
    expect(adFieldsFromUtm('x')).toEqual({})
  })
})

describe('booked-from page', () => {
  it('rides in salesforce_uuid even with no ad tags', () => {
    expect(new URL(withUtm('https://calendly.com/x/y', {}, '/campaign-shoots')).searchParams.get('salesforce_uuid')).toBe('/campaign-shoots')
  })
})
