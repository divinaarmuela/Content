import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * "Shoot booked" reached the same account manager twice — once as the
 * shoot's owner, once as one of the client's managers (the live walk of
 * 12 Sep 2026). A person in two audiences is told once.
 */

const emails: Record<string, unknown>[] = []
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m); return 'sent' }),
  renderEmail: (h: string, b: string) => `${h}${b}`,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { notifyBatchTransition } = await import('../app/lib/workflow')

const AM = { id: 'a0000000-0000-4000-8000-000000000a01', role: 'account_manager', email: 'am@zz.invalid', name: 'Priya', clerk_user_id: null, active_status: true }
const OTHER_AM = { id: 'a0000000-0000-4000-8000-000000000a02', role: 'account_manager', email: 'ben@zz.invalid', name: 'Ben', clerk_user_id: null, active_status: true }
const SUPER = { id: 'a0000000-0000-4000-8000-000000000a03', role: 'super_admin', email: 'sa@zz.invalid', name: 'Akmal', clerk_user_id: null, active_status: true }

let fake: ReturnType<typeof seedDb>
afterEach(() => fake.restore())

describe('a shoot booked: one email per person', () => {
  it('tells the owner who is also a client manager once, and the other manager once', async () => {
    fake = seedDb({
      clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
      team_users: [AM, OTHER_AM, SUPER] as unknown as Row[],
      team_user_clients: [
        { id: `${AM.id}__c1`, team_user_id: AM.id, client_id: 'c1' },
        { id: `${OTHER_AM.id}__c1`, team_user_id: OTHER_AM.id, client_id: 'c1' },
      ] as unknown as Row[],
    })
    emails.length = 0
    notifyBatchTransition(SUPER as never, { id: 'b1', client_id: 'c1', title: 'Golf Day', owner_id: AM.id, shoot_date: '2026-09-22' }, 'brief', 'locked')
    await new Promise(r => setTimeout(r, 200))
    const to = emails.map(e => String(e.recipientEmail)).sort()
    expect(to).toEqual(['am@zz.invalid', 'ben@zz.invalid'])
    expect(emails.every(e => String(e.subject) === 'Shoot booked: Golf Day')).toBe(true)
  })
})
