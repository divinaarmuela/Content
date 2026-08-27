import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  authorizeDelivery,
  parseZernioEvent,
  signZernioBody,
  verifyZernioSignature,
  ZERNIO_WEBHOOK_EVENTS,
} from '../app/lib/zernio-webhook-core'

const SECRET = 'a-webhook-secret'
const body = (o: unknown) => JSON.stringify(o)

describe('signature verification', () => {
  const raw = body({ id: 'evt_1', event: 'post.published' })
  const good = createHmac('sha256', SECRET).update(raw, 'utf8').digest('hex')

  it('matches the provider recipe: lowercase hex HMAC-SHA256 of the raw body', () => {
    expect(signZernioBody(raw, SECRET)).toBe(good)
    expect(good).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts a genuine signature', () => {
    expect(verifyZernioSignature(raw, good, [SECRET])).toBe(true)
  })

  it('tolerates a sha256= prefix, whitespace and uppercase hex', () => {
    expect(verifyZernioSignature(raw, ` sha256=${good.toUpperCase()} `, [SECRET])).toBe(true)
  })

  it('rejects a signature made with the wrong secret', () => {
    expect(verifyZernioSignature(raw, good, ['another-secret'])).toBe(false)
  })

  it('rejects a signature over a DIFFERENT body — one byte is enough', () => {
    const tampered = body({ id: 'evt_1', event: 'post.published', extra: 1 })
    expect(verifyZernioSignature(tampered, good, [SECRET])).toBe(false)
  })

  it('rejects a missing or malformed signature rather than throwing', () => {
    expect(verifyZernioSignature(raw, null, [SECRET])).toBe(false)
    expect(verifyZernioSignature(raw, '', [SECRET])).toBe(false)
    expect(verifyZernioSignature(raw, 'not-hex', [SECRET])).toBe(false)
    expect(verifyZernioSignature(raw, good.slice(0, 10), [SECRET])).toBe(false)
  })

  it('accepts any of several live secrets, so registering cannot orphan deliveries', () => {
    expect(verifyZernioSignature(raw, good, ['old-one', SECRET])).toBe(true)
  })
})

describe('authorizeDelivery', () => {
  const raw = body({ event: 'post.published' })
  const good = signZernioBody(raw, SECRET)

  it('refuses to act at all when no secret is configured', () => {
    expect(authorizeDelivery({ rawBody: raw, signature: good, secrets: [] })).toBe('unconfigured')
    expect(authorizeDelivery({ rawBody: raw, token: SECRET, secrets: [''] })).toBe('unconfigured')
  })

  it('accepts a signed delivery', () => {
    expect(authorizeDelivery({ rawBody: raw, signature: good, secrets: [SECRET] })).toBe('ok')
  })

  it('rejects a signed delivery whose signature does not verify, ignoring any token', () => {
    expect(authorizeDelivery({
      rawBody: raw, signature: 'f'.repeat(64), token: SECRET, secrets: [SECRET],
    })).toBe('unauthorized')
  })

  it('falls back to a shared secret when the delivery is unsigned', () => {
    expect(authorizeDelivery({ rawBody: raw, token: SECRET, secrets: [SECRET] })).toBe('ok')
    expect(authorizeDelivery({ rawBody: raw, token: 'wrong', secrets: [SECRET] })).toBe('unauthorized')
    expect(authorizeDelivery({ rawBody: raw, secrets: [SECRET] })).toBe('unauthorized')
  })
})

describe('payload → action', () => {
  it('reads a post.published envelope: id, permalink and platforms', () => {
    const { eventId, action } = parseZernioEvent({
      id: 'evt_abc',
      event: 'post.published',
      timestamp: '2026-08-27T01:00:00Z',
      data: {
        post: {
          _id: '65f0c0ffee00000000000001',
          status: 'published',
          platforms: [
            { platform: 'instagram', status: 'published', platformPostUrl: 'https://instagram.com/p/x' },
            { platform: 'facebook', status: 'published' },
          ],
        },
      },
    })
    expect(eventId).toBe('evt_abc')
    expect(action).toEqual({
      kind: 'published',
      postId: '65f0c0ffee00000000000001',
      permalink: 'https://instagram.com/p/x',
      platforms: ['instagram', 'facebook'],
    })
  })

  it('accepts `id` as the post id — the webhook guide spells it that way', () => {
    const { action } = parseZernioEvent({
      event: 'post.published', data: { post: { id: 'post_9', platforms: [] } },
    })
    expect(action).toMatchObject({ kind: 'published', postId: 'post_9', permalink: null })
  })

  it('reads a post with no envelope, which is how the account webhook arrives', () => {
    const { action } = parseZernioEvent({ event: 'post.published', post: { _id: 'post_7' } })
    expect(action).toMatchObject({ kind: 'published', postId: 'post_7' })
  })

  it('carries the provider’s reason through on post.failed', () => {
    const { action } = parseZernioEvent({
      event: 'post.failed',
      data: {
        post: {
          _id: 'post_2',
          platforms: [{ platform: 'tiktok', status: 'failed', errorMessage: 'Token expired' }],
        },
      },
    })
    expect(action).toEqual({ kind: 'failed', postId: 'post_2', error: 'Token expired' })
  })

  it('says WHICH platforms failed on a partial, and does not call it published', () => {
    const { action } = parseZernioEvent({
      event: 'post.partial',
      data: {
        post: {
          _id: 'post_3',
          platforms: [
            { platform: 'instagram', status: 'published', platformPostUrl: 'https://ig/x' },
            { platform: 'linkedin', status: 'failed', errorMessage: 'Rejected by LinkedIn' },
          ],
        },
      },
    })
    expect(action.kind).toBe('failed')
    expect(action).toMatchObject({ postId: 'post_3' })
    expect((action as { error: string }).error).toContain('Rejected by LinkedIn')
    expect((action as { error: string }).error).toContain('some platforms only')
  })

  it('still records a failure when the provider gives no reason', () => {
    const { action } = parseZernioEvent({ event: 'post.failed', data: { post: { _id: 'p' } } })
    expect(action).toEqual({
      kind: 'failed', postId: 'p', error: 'The provider reported the post as failed',
    })
  })

  it('keeps the account.disconnected behaviour that has been live since 20 Aug', () => {
    expect(parseZernioEvent({ event: 'account.disconnected', data: { accountId: 'acc_1' } }).action)
      .toEqual({ kind: 'account_inactive', accountId: 'acc_1' })
    expect(parseZernioEvent({ event: 'account.token_expired', account: { _id: 'acc_2' } }).action)
      .toEqual({ kind: 'account_inactive', accountId: 'acc_2' })
  })

  it('ignores events we do not act on, rather than mistaking them for a publish', () => {
    for (const event of [
      'post.scheduled', 'post.cancelled', 'post.platform.published',
      'webhook.test', 'message.received', '',
    ]) {
      expect(parseZernioEvent({ event, data: { post: { _id: 'p' } } }).action.kind).toBe('ignore')
    }
  })

  it('ignores a post event with no post id — there is nothing to look up', () => {
    expect(parseZernioEvent({ event: 'post.published', data: { post: {} } }).action)
      .toEqual({ kind: 'ignore', reason: 'no post id' })
  })

  it('never throws on rubbish, however badly shaped', () => {
    for (const junk of [null, undefined, 42, 'text', [], { data: [] }, { event: {} }]) {
      expect(parseZernioEvent(junk).action.kind).toBe('ignore')
    }
  })

  it('registers exactly the events the handler knows how to act on', () => {
    for (const event of ZERNIO_WEBHOOK_EVENTS) {
      expect(parseZernioEvent({ event, data: { post: { _id: 'p' }, accountId: 'a' } }).action.kind)
        .not.toBe('ignore')
    }
  })
})
