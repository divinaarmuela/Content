import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'

/**
 * NEVER AN EMAIL TO THE CLIENT (the owner, 13 Sep 2026: "never send any
 * email to the client"). The mailer itself refuses anything marked for a
 * client, before the bell and before the notification_log claim, so no
 * caller can send one by accident — whatever the env says.
 */

vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))

const { notify, clientNotificationsPaused } = await import('../app/lib/mailer')

let fake: ReturnType<typeof seedDb>
afterEach(() => { fake?.restore(); delete process.env.PAUSE_CLIENT_NOTIFICATIONS })

describe('the mailer and the client', () => {
  it('client mail is off as a rule, not a pause — the env switch does not turn it back on', () => {
    delete process.env.PAUSE_CLIENT_NOTIFICATIONS
    expect(clientNotificationsPaused()).toBe(true)
    process.env.PAUSE_CLIENT_NOTIFICATIONS = '0'
    expect(clientNotificationsPaused()).toBe(true)
  })
  it('a notification marked for a client is dropped: no email, no bell row, nothing logged', async () => {
    fake = seedDb({ notification_log: [], team_users: [] })
    const r = await notify({
      eventType: 'shoot_plan_to_client', entityType: 'batch', entityId: 'b-1#client',
      recipientEmail: 'client@zz.invalid', toClient: true,
      subject: 'Your shoot plan', bodyHtml: '<p>hi</p>',
    })
    expect(r).toBe('muted')
    expect(fake.rows('notification_log')).toHaveLength(0)
  })
})
