import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerZernioWebhook } from '../app/lib/publisher'
import { ZERNIO_WEBHOOK_EVENTS } from '../app/lib/zernio-webhook-core'

/**
 * "Enable instant post updates", against a fake provider.
 *
 * The two failures this guards against both cost real money in delivered
 * events rather than in errors:
 *
 *   1. Registering a SECOND webhook for the same endpoint, because the URL the
 *      owner typed by hand differs from ours by a slash. Zernio allows 50
 *      registrations and de-duplicates none of them, so the result is every
 *      event delivered twice, forever, with nothing anywhere reporting a
 *      problem.
 *   2. REPLACING the event list on an existing registration. The PUT body
 *      carries the whole array, so sending only our list silently unsubscribes
 *      from anything the owner had added — again with a 200 and no complaint.
 */

const calls: { method: string; body: Record<string, unknown> | null }[] = []
let existing: Record<string, unknown>[] = []

beforeEach(() => {
  process.env.ZERNIO_API_KEY = 'test-key'
  calls.length = 0
  existing = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    calls.push({ method, body })
    if (method === 'GET') return json({ webhooks: existing })
    return json({ webhook: { _id: String(body?._id ?? 'hook_new'), ...body } })
  })
})

afterEach(() => { vi.unstubAllGlobals() })

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200, headers: { 'content-type': 'application/json' },
  })
}

const register = () => registerZernioWebhook({
  url: 'https://app.mdmmarketing.com.au/api/social/webhook',
  secret: 'a-secret',
  events: ZERNIO_WEBHOOK_EVENTS,
})

describe('registerZernioWebhook', () => {
  it('creates the registration when there is none, asking for every event', async () => {
    const hook = await register()

    expect(calls.map(c => c.method)).toEqual(['GET', 'POST'])
    expect(hook.created).toBe(true)
    const sent = calls[1].body!.events as string[]
    for (const event of ['post.published', 'post.platform.published', 'comment.received',
      'message.received', 'account.connected', 'review.new', 'lead.received']) {
      expect(sent).toContain(event)
    }
  })

  it('updates the existing registration rather than adding a second one', async () => {
    existing = [{
      _id: 'hook_1',
      url: 'https://app.mdmmarketing.com.au/api/social/webhook',
      events: ['post.published', 'post.failed'],
    }]

    const hook = await register()

    expect(calls.map(c => c.method)).toEqual(['GET', 'PUT'])
    expect(calls[1].body).toMatchObject({ _id: 'hook_1' })
    expect(hook.created).toBe(false)
  })

  it('recognises the registration the owner made by hand, however they typed the URL', async () => {
    for (const url of [
      'https://app.mdmmarketing.com.au/api/social/webhook/',
      'https://app.mdmmarketing.com.au/api/zernio/webhook',
      'https://app.mdmmarketing.com.au/api/social/webhook?source=zernio',
    ]) {
      calls.length = 0
      existing = [{ _id: 'hook_hand', url, events: ['post.published'] }]
      await register()
      expect(calls.map(c => c.method), url).toEqual(['GET', 'PUT'])
      expect(calls[1].body, url).toMatchObject({ _id: 'hook_hand' })
    }
  })

  it('ADDS the missing events instead of replacing what was already subscribed', async () => {
    existing = [{
      _id: 'hook_1',
      url: 'https://app.mdmmarketing.com.au/api/social/webhook',
      // one the owner set that we do not ask for, and one we do
      events: ['whatsapp.number.activated', 'post.published'],
    }]

    await register()

    const sent = calls[1].body!.events as string[]
    expect(sent).toContain('whatsapp.number.activated')   // kept, not dropped
    expect(sent).toContain('post.platform.published')     // added
    expect(new Set(sent).size).toBe(sent.length)          // no duplicates
  })

  it('does not mistake somebody else’s webhook for ours', async () => {
    existing = [{ _id: 'not_ours', url: 'https://hooks.slack.com/services/xxx', events: [] }]
    const hook = await register()
    expect(calls.map(c => c.method)).toEqual(['GET', 'POST'])
    expect(hook.created).toBe(true)
  })

  it('still registers when the provider will not list what exists', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'GET') return new Response('nope', { status: 500 })
      calls.push({ method, body: JSON.parse(String(init?.body)) as Record<string, unknown> })
      return json({ webhook: { _id: 'hook_new' } })
    })
    const hook = await register()
    expect(hook.created).toBe(true)
  })
})
