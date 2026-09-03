import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'

/**
 * EMAIL_TEST_ONLY covers the BELL, not just the outbox.
 *
 * A bell-only notification never reaches the send path, so the guard that
 * lives down there never ran for it — and a live test run wrote real in-app
 * notifications against real team members (WATCHERS in booking-notify.ts is a
 * literal list of four agency addresses). Under the kill-switch a non-.invalid
 * recipient must produce NO row at all: the notifications page reads those
 * rows, so writing one is the delivery.
 */

let fake: ReturnType<typeof seedDb>
const before = process.env.EMAIL_TEST_ONLY

beforeEach(() => { fake = seedDb({}) })
afterEach(() => {
  fake.restore()
  if (before === undefined) delete process.env.EMAIL_TEST_ONLY
  else process.env.EMAIL_TEST_ONLY = before
})

const bell = (recipientEmail: string) => ({
  eventType: 'booking.created',
  entityType: 'booking',
  entityId: 'bk-1',
  recipientEmail,
  subject: 'A booking came in',
  bodyHtml: '<p>hi</p>',
  bellOnly: true,
})

describe('notify() under EMAIL_TEST_ONLY', () => {
  it('refuses a bell-only notification to a real address and writes nothing', async () => {
    process.env.EMAIL_TEST_ONLY = '1'
    const { notify } = await import('../app/lib/mailer')
    expect(await notify(bell('martin@mdmmarketing.com.au'))).toBe('failed')
    expect(fake.rows('notification_log')).toHaveLength(0)
  })

  it('still delivers a bell-only notification to a .invalid address', async () => {
    process.env.EMAIL_TEST_ONLY = '1'
    const { notify } = await import('../app/lib/mailer')
    expect(await notify(bell('watcher@mdmedia-test.invalid'))).toBe('sent')
    const rows = fake.rows('notification_log') as unknown as { channel: string; status: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ channel: 'in_app', status: 'sent' })
  })

  it('leaves the bell alone when the kill-switch is off', async () => {
    delete process.env.EMAIL_TEST_ONLY
    const { notify } = await import('../app/lib/mailer')
    expect(await notify(bell('martin@mdmmarketing.com.au'))).toBe('sent')
    expect(fake.rows('notification_log')).toHaveLength(1)
  })
})
