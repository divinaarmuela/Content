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

  /**
   * Fixtures below follow the shapes in Zernio's OpenAPI document
   * (`docs.zernio.com/api/openapi`, `components.schemas.WebhookPayload*`),
   * not the prose pages — the prose does not print a single JSON example, and
   * the two spellings that matter (`publishedUrl`, not `platformPostUrl`, and
   * `error`, not `errorMessage`) only appear in the schema.
   */
  it('reads a per-platform publish: url, platform post id and account', () => {
    const { action } = parseZernioEvent({
      id: 'evt_pp',
      event: 'post.platform.published',
      data: {
        post: { id: 'post_10', status: 'publishing', platforms: [] },
        platform: {
          name: 'instagram', status: 'published',
          platformPostId: '17900', publishedUrl: 'https://instagram.com/p/abc',
        },
        account: { accountId: 'acc_9', platform: 'instagram', username: 'client' },
      },
      timestamp: '2026-08-27T01:00:00Z',
    })
    expect(action).toEqual({
      kind: 'platform_published',
      postId: 'post_10',
      platform: 'instagram',
      permalink: 'https://instagram.com/p/abc',
      platformPostId: '17900',
      accountId: 'acc_9',
      backfillOnly: false,
    })
  })

  it('treats a resolved TikTok url as a back-fill, never as a state change', () => {
    const { action } = parseZernioEvent({
      id: 'evt_tt',
      event: 'post.tiktok.url_resolved',
      data: {
        post: { id: 'post_11', status: 'published', platforms: [] },
        platform: {
          name: 'tiktok', status: 'published',
          platformPostId: '73991', publishedUrl: 'https://tiktok.com/@c/video/73991',
        },
        account: { accountId: 'acc_3', platform: 'tiktok', username: 'c' },
      },
    })
    expect(action).toMatchObject({
      kind: 'platform_published',
      postId: 'post_11',
      permalink: 'https://tiktok.com/@c/video/73991',
      backfillOnly: true,
    })
  })

  it('carries the platform’s own words on a per-platform failure', () => {
    const { action } = parseZernioEvent({
      id: 'evt_pf',
      event: 'post.platform.failed',
      data: {
        post: { id: 'post_12', platforms: [] },
        platform: { name: 'linkedin', status: 'failed', error: 'Document too large' },
        account: { accountId: 'acc_4', platform: 'linkedin', username: 'c' },
      },
    })
    expect(action).toEqual({
      kind: 'platform_failed', postId: 'post_12',
      platform: 'linkedin', error: 'Document too large',
    })
  })

  it('still names the platform when it fails without saying why', () => {
    const { action } = parseZernioEvent({
      event: 'post.platform.failed',
      data: { post: { id: 'p' }, platform: { name: 'threads', status: 'failed' } },
    })
    expect((action as { error: string }).error).toContain('threads')
  })

  it('reads a cancellation, and a scheduling confirmation, as their own things', () => {
    expect(parseZernioEvent({ id: 'e1', event: 'post.cancelled', data: { post: { id: 'p' } } }).action)
      .toEqual({ kind: 'cancelled', postId: 'p' })
    expect(parseZernioEvent({
      id: 'e2', event: 'post.scheduled',
      data: { post: { id: 'p', scheduledFor: '2026-08-28T09:00:00Z' } },
    }).action).toEqual({ kind: 'scheduled', postId: 'p', scheduledFor: '2026-08-28T09:00:00Z' })
  })

  it('reads account.connected without confusing it with a disconnect', () => {
    const { action } = parseZernioEvent({
      id: 'evt_ac',
      event: 'account.connected',
      data: {
        account: {
          accountId: 'acc_new', profileId: 'prof_1',
          platform: 'Instagram', username: 'client',
        },
      },
    })
    expect(action).toEqual({
      kind: 'account_connected', accountId: 'acc_new', profileId: 'prof_1', platform: 'instagram',
    })
  })

  it('reads a comment, keeping only the fields we look things up by', () => {
    const { action } = parseZernioEvent({
      id: 'evt_c',
      event: 'comment.received',
      data: {
        comment: {
          id: 'cmt_1', postId: 'post_1', platformPostId: '1790', platform: 'instagram',
          text: 'LINK please', author: { id: 'u1' }, isReply: false, parentCommentId: null,
        },
        post: { id: 'post_1', platformPostId: '1790', content: null, imageUrl: null, permalink: null },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'instagram', username: 'client' },
      },
    })
    expect(action).toEqual({
      kind: 'comment', commentId: 'cmt_1', accountId: 'acc_1',
      platform: 'instagram', platformPostId: '1790', text: 'LINK please',
    })
  })

  it('collapses the whole inbox family into one "you are out of date"', () => {
    for (const event of ['message.received', 'message.sent', 'reaction.received', 'conversation.started']) {
      const { action } = parseZernioEvent({
        id: `evt_${event}`,
        event,
        data: {
          message: { id: 'm', conversationId: 'conv_1', platform: 'instagram' },
          conversation: { id: 'conv_1', platformConversationId: 'p', status: 'active' },
          account: { id: 'acc_1', accountId: 'acc_1', platform: 'instagram', username: 'c' },
        },
      })
      expect(action).toEqual({
        kind: 'inbox', accountId: 'acc_1', conversationId: 'conv_1',
        platform: 'instagram', detail: event,
      })
    }
  })

  it('reads a review with its rating, and marks an update as one', () => {
    const payload = (event: string) => ({
      id: `evt_${event}`,
      event,
      data: {
        review: {
          id: 'rev_1', platform: 'googlebusiness', rating: 5, text: 'Great work',
          reviewer: { id: null, name: 'A', profileImage: null },
          createdAt: '2026-08-27T00:00:00Z', hasReply: false,
        },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'googlebusiness', username: 'c' },
      },
    })
    expect(parseZernioEvent(payload('review.new')).action).toEqual({
      kind: 'review', reviewId: 'rev_1', accountId: 'acc_1',
      platform: 'googlebusiness', rating: 5, text: 'Great work', updated: false,
    })
    expect(parseZernioEvent(payload('review.updated')).action)
      .toMatchObject({ kind: 'review', updated: true })
  })

  it('flattens a lead’s fields to strings and keeps the form it came from', () => {
    const { action } = parseZernioEvent({
      id: 'evt_l',
      event: 'lead.received',
      data: {
        lead: {
          id: 'lead_1', leadgenId: '99', formId: 'f1', formName: 'Book a call',
          isOrganic: false, createdAt: '2026-08-27T00:00:00Z',
          fields: { full_name: 'Jane', email: 'jane@example.com', empty: '' },
        },
        account: { id: 'acc_1', accountId: 'acc_1', platform: 'facebook' },
      },
    })
    expect(action).toEqual({
      kind: 'lead', leadId: 'lead_1', accountId: 'acc_1', formName: 'Book a call',
      fields: { full_name: 'Jane', email: 'jane@example.com' },
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
      'webhook.test', 'post.external.created', 'post.platform.deleted',
      'call.received', 'whatsapp.template.status_updated', 'verification.approved',
      'ad.status_changed', 'account.ads.initial_sync_completed', '',
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

  /**
   * The registration list is deliberately WIDER than the acted-on list: an
   * event we merely log still lands in `webhook_deliveries`, which is how the
   * next person discovers it really does arrive. What must not happen is the
   * reverse — an event the handler acts on that we never asked for, which
   * would be dead code waiting for a delivery that never comes.
   */
  it('subscribes to every event the handler acts on', () => {
    const acted = [
      ['post.published', { post: { id: 'p' } }],
      ['post.failed', { post: { id: 'p' } }],
      ['post.partial', { post: { id: 'p' } }],
      ['post.scheduled', { post: { id: 'p' } }],
      ['post.cancelled', { post: { id: 'p' } }],
      ['post.platform.published', { post: { id: 'p' }, platform: { name: 'instagram' } }],
      ['post.platform.failed', { post: { id: 'p' }, platform: { name: 'instagram' } }],
      ['post.tiktok.url_resolved', { post: { id: 'p' }, platform: { name: 'tiktok' } }],
      ['account.connected', { account: { accountId: 'a' } }],
      ['account.disconnected', { account: { accountId: 'a' } }],
      ['comment.received', { comment: { id: 'c' } }],
      ['message.received', { message: { conversationId: 'x' } }],
      ['conversation.started', { conversation: { id: 'x' } }],
      ['reaction.received', { conversation: { id: 'x' } }],
      ['review.new', { review: { id: 'r' } }],
      ['lead.received', { lead: { id: 'l' } }],
    ] as const

    for (const [event, data] of acted) {
      expect(ZERNIO_WEBHOOK_EVENTS as readonly string[]).toContain(event)
      expect(parseZernioEvent({ id: `evt-${event}`, event, data }).action.kind).not.toBe('ignore')
    }
  })

  it('never mistakes an event we only log for one we act on', () => {
    // every subscribed event must parse to SOMETHING, and never throw
    for (const event of ZERNIO_WEBHOOK_EVENTS) {
      expect(() => parseZernioEvent({ id: 'e', event, data: {} })).not.toThrow()
    }
  })
})
