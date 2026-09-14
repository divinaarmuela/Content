import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * THE ACCOUNT MANAGER HEARS A CARD WAS MADE (the owner, 14 Sep 2026: "an
 * editor puts the folder to work, assigns themselves as Who — regardless of
 * which shoot — the AM must be told a card was created").
 *
 * A card the maker made and holds is never a "yours to make" email to
 * themselves, so without this the AM heard nothing. `notifyCardMade` fills
 * that: the client's account managers (and super admins on the client) are
 * told, whoever the maker assigned it to and whatever shoot it came from —
 * but a manager making their own card does not spam the other managers.
 */

const emails: Record<string, unknown>[] = []
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m); return 'sent' }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
// afterResponse runs the job detached outside a request; drain() lets it settle
vi.mock('../app/lib/after-response', () => ({
  afterResponse: (_l: string, run: () => Promise<unknown>) => { void run() },
}))

const { notifyCardMade } = await import('../app/lib/workflow')

const AM = { id: 'am-1', name: 'Karly', email: 'karly@zz.invalid', role: 'account_manager', active_status: true }
const AM2 = { id: 'am-2', name: 'Divina', email: 'divina@zz.invalid', role: 'super_admin', active_status: true }
const ED = { id: 'ed-1', name: 'Sam', email: 'sam@zz.invalid', role: 'editor', active_status: true, clerk_user_id: null }

let fake: ReturnType<typeof seedDb>
const drain = () => new Promise(r => setTimeout(r, 40))
const item = (over: Record<string, unknown> = {}) => ({
  id: 'i-1', client_id: 'c1', title: 'Spring reel', content_type: 'reel',
  owner_id: ED.id, batch_id: null, brief: 'Cut a 30s version', ...over,
}) as never

beforeEach(() => {
  emails.length = 0
  fake = seedDb({
    clients: [{ id: 'c1', name: 'Park Noire' }] as unknown as Row[],
    team_users: [AM, AM2, ED] as unknown as Row[],
    team_user_clients: [
      { id: 'l1', team_user_id: AM.id, client_id: 'c1' },
      { id: 'l2', team_user_id: AM2.id, client_id: 'c1' },
    ] as unknown as Row[],
  } as never)
})
afterEach(() => fake.restore())

describe('notifyCardMade', () => {
  it('an editor who makes a card, assigned to themselves, tells the client’s managers', async () => {
    notifyCardMade(ED as never, item())
    await drain()
    expect(emails.map(e => e.recipientEmail).sort()).toEqual(['divina@zz.invalid', 'karly@zz.invalid'])
    expect(String(emails[0].subject)).toBe('Sam made a card for Park Noire: Spring reel')
  })

  it('tells them whatever shoot it came from — or none', async () => {
    notifyCardMade(ED as never, item({ batch_id: 'b-9' }))
    await drain()
    expect(emails).toHaveLength(2)
    expect(String(emails[0].bodyHtml)).toContain('from a shoot')
  })

  it('a manager making their own card does not spam the other managers', async () => {
    notifyCardMade(AM as never, item({ owner_id: AM.id }))
    await drain()
    expect(emails).toHaveLength(0)
  })

  it('never emails the maker, even when they are one of the client’s managers', async () => {
    notifyCardMade(AM2 as never, item({ owner_id: AM2.id }))
    await drain()
    // AM2 is a super admin on the client, so notifyCardMade skips entirely
    expect(emails).toHaveLength(0)
  })
})
