import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { TEST_CLIENT_IDS, isTestClient, isTestPerson, mayEmailAboutClient } from '../app/lib/test-clients-core'

// the owner, 30 Sep 2026: "don't test with real client" · "did anyone get notified"
describe('a test client never emails a real person', () => {
  const HUNDRED_M = '459e2564-1089-45ed-abd7-56d5f53c2cf6'
  it('knows the three test clients, and nothing else', () => {
    expect(TEST_CLIENT_IDS).toHaveLength(3)
    expect(isTestClient(HUNDRED_M)).toBe(true)
    expect(isTestClient('2e27f9e4-9cb5-43a6-a06b-f317f207a1e8')).toBe(false) // Justin Engelke
    expect(isTestClient(null)).toBe(false)
  })
  it('about a test client: Joy is not emailed; a Test account and the test inbox are', () => {
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'joy@mdmmarketing.com.au', person: { name: 'Joy Armuela' } })).toBe(false)
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'x@mdmmarketing.com.au', person: { name: 'Test Scheduler' } })).toBe(true)
    expect(mayEmailAboutClient(HUNDRED_M, { email: 'AkmalAshwin23@gmail.com ' })).toBe(true)
    expect(isTestPerson({ name: 'Testing Tom' })).toBe(false)
  })
  it('about a real client: everyone is emailed as before', () => {
    expect(mayEmailAboutClient('2e27f9e4-9cb5-43a6-a06b-f317f207a1e8', { email: 'joy@mdmmarketing.com.au', person: { name: 'Joy Armuela' } })).toBe(true)
  })
  it('the mailer asks, before it writes a log row', () => {
    const src = readFileSync('app/lib/mailer.ts', 'utf8')
    const ask = src.indexOf('mayEmailAboutClient(aboutClient')
    const claim = src.indexOf("await table('notification_log').insert(")
    expect(ask).toBeGreaterThan(0)
    expect(ask).toBeLessThan(claim)
  })
})
