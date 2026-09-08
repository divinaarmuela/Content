import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A POST THAT DID NOT GO OUT IS SAID OUT LOUD.
 *
 * A publish job that fails writes `failed` and a reason on its own row and
 * tells nobody. The item it belongs to sits at `scheduled`, which the due
 * sweep skipped by name — so a post that died in October was discovered by
 * the client, in November, when they asked where it was.
 *
 * Team-facing only: the client is never emailed about this.
 */

let emails: Record<string, unknown>[] = []
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { emails.push(m); return 'sent' }),
  renderEmail: (head: string, body: string, _cta: string, href: string) => `${head}${body}${href}`,
  escapeHtml: (s: string) => s,
}))

const { runDueReminders } = await import('../app/lib/due-reminders')

const item = (over: Record<string, unknown> = {}): Row => ({
  id: 'item-1', title: 'Spring campaign film', client_id: 'c1',
  work_kind_id: 'wk-social', owner_id: 'u-owner', status: 'scheduled',
  // booked for a month ago: nothing about the due date is what makes this
  // worth telling somebody about
  due_date: '2026-08-01',
  created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  ...over,
} as unknown as Row)

const publishJob = (over: Record<string, unknown> = {}): Row => ({
  id: 'pj-1', content_item_id: 'item-1', client_id: 'c1', status: 'failed',
  caption: 'Hello', request_id: 'req-1', media: [], targets: [],
  timezone: 'Australia/Melbourne', scheduled_for: null, attempts: 1,
  error: 'Could not prepare a copy for Instagram — try a smaller export',
  created_at: '2026-09-07T00:00:00.000Z',
  updated_at: new Date().toISOString(),
  ...over,
} as unknown as Row)

const person = (id: string, role: string): Row => ({
  id, email: `${id}@example.invalid`, name: id, role, active_status: true,
} as unknown as Row)

const base = (over: Partial<Record<string, Row[]>> = {}) => seedDb({
  content_items: over.content_items ?? [item()],
  publish_jobs: over.publish_jobs ?? [publishJob()],
  clients: [{ id: 'c1', name: 'Acme' } as unknown as Row],
  work_kinds: [{ id: 'wk-social', slug: 'social' } as unknown as Row],
  team_users: [person('u-owner', 'account_manager'), person('u-sched', 'scheduler')],
  team_user_clients: [{ id: 'tuc-1', team_user_id: 'u-owner', client_id: 'c1' } as unknown as Row],
})

let fake: ReturnType<typeof seedDb>
beforeEach(() => { emails = [] })
afterEach(() => fake?.restore())

describe('the morning sweep', () => {
  it('tells the scheduler and the card’s owner that a post did not go out', async () => {
    fake = base()
    const out = await runDueReminders()
    expect(out.items).toBe(1)

    const to = emails.map(e => e.recipientEmail).sort()
    expect(to).toEqual(['u-owner@example.invalid', 'u-sched@example.invalid'])
    expect(String(emails[0].subject)).toBe('Did not go out: Spring campaign film')
    // the reason the job recorded, so a scheduler knows whether to re-export
    // the video or simply try again — and a way back to the post
    expect(String(emails[0].bodyHtml)).toContain('Could not prepare a copy for Instagram')
    expect(String(emails[0].bodyHtml)).toContain('/dashboard/production/item-1')
    // once per day, whatever the sweep is re-run
    expect(String(emails[0].entityId)).toMatch(/^item-1#failed#/)
  })

  it('says nothing when the post went out', async () => {
    fake = base({ publish_jobs: [publishJob({ status: 'published', error: null })] })
    expect(await runDueReminders()).toEqual({ items: 0, emails: 0 })
    expect(emails).toEqual([])
  })

  it('does not send twice for a card that is also overdue', async () => {
    fake = base({ content_items: [item({ status: 'in_editing', due_date: '2026-08-01' })] })
    await runDueReminders()
    const subjects = emails.map(e => String(e.subject))
    expect(subjects.every(s => s.startsWith('⚠️ Overdue'))).toBe(true)
  })

  it('honours the handoff: an item assigned to schedulers reminds those schedulers', async () => {
    fake = base({ content_items: [item({ scheduler_ids: ['u-sched'] })] })
    await runDueReminders()
    expect(emails.map(e => e.recipientEmail).sort())
      .toEqual(['u-owner@example.invalid', 'u-sched@example.invalid'])
  })
})
