import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { encodeKey } from '@/lib/db'
import { buildDedupeKey } from '../app/lib/identity-core'

/**
 * The remaining "exactly one winner" rules, each staged as a real race.
 *
 * Every case here does the same thing: two claimants, a rival's write landing
 * between the first claimant's read and its own, and an assertion that the
 * loser's SIDE EFFECT — the provider call, the email, the second row — never
 * happened. A guard that merely returns the right answer while the work runs
 * twice is not a guard.
 */

const smtpSends: string[] = []
/** Stand in for SMTP2GO, and count what actually left the building. */
function stubTransport() {
  process.env.SMTP2GO_API_KEY = 'test-key'
  const inner = globalThis.fetch
  globalThis.fetch = (async (i: never, init: never) => {
    const url = String(typeof i === 'string' ? i : (i as Request).url)
    if (url.includes('smtp2go')) {
      smtpSends.push(JSON.parse(String((init as RequestInit).body)).subject)
      return new Response(JSON.stringify({ data: { succeeded: 1 } }), { status: 200 })
    }
    return inner(i, init)
  }) as typeof fetch
}
const createdProfiles: string[] = []
vi.mock('../app/lib/publisher', () => ({
  getPublisher: () => ({
    configured: () => true,
    createProfile: async (name: string) => { createdProfiles.push(name); return `prof-${createdProfiles.length}` },
    connectUrl: async () => 'https://connect.example/x',
  }),
}))

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => {
  fake?.restore(); fake = null
  smtpSends.length = 0; createdProfiles.length = 0
})

describe('claim locks', () => {
  it('one holder wins, and the loser is told who has it', async () => {
    fake = seedDb({})
    const { takeClaimLock, releaseClaimLock } = await import('../app/lib/claim-lock')
    const [a, b] = await Promise.all([
      takeClaimLock('thing__1', 'holder-a'),
      takeClaimLock('thing__1', 'holder-b'),
    ])
    const winners = [a, b].filter(r => r.ok)
    expect(winners).toHaveLength(1)
    const loser = [a, b].find(r => !r.ok) as { ok: false; holder: string }
    expect(['holder-a', 'holder-b']).toContain(loser.holder)

    // taking a lock you already hold is not a conflict
    expect(await takeClaimLock('thing__1', (fake.rows('claim_locks')[0] as unknown as { holder: string }).holder)).toEqual({ ok: true })

    // and it is claimable again once it is handed back
    await releaseClaimLock('thing__1', (fake.rows('claim_locks')[0] as unknown as { holder: string }).holder)
    expect(await takeClaimLock('thing__1', 'holder-c')).toEqual({ ok: true })
  })

  it('a lock whose holder is long gone is taken over, once', async () => {
    fake = seedDb({})
    const { takeClaimLock } = await import('../app/lib/claim-lock')
    // an old lock nothing stands behind any more
    fake.tree().mdm.tables.claim_locks = {
      thing__2: { id: 'thing__2', holder: 'ghost', at: '2026-01-01T00:00:00.000Z' },
    }
    const stillHeld = async () => false
    const [a, b] = await Promise.all([
      takeClaimLock('thing__2', 'holder-a', stillHeld),
      takeClaimLock('thing__2', 'holder-b', stillHeld),
    ])
    expect([a, b].filter(r => r.ok)).toHaveLength(1)
  })

  it('a lock taken moments ago is believed, even with nothing behind it yet', async () => {
    fake = seedDb({})
    const { takeClaimLock } = await import('../app/lib/claim-lock')
    await takeClaimLock('thing__3', 'holder-a')
    // the holder is still writing the row it protects — never steal it
    const second = await takeClaimLock('thing__3', 'holder-b', async () => false)
    expect(second).toEqual({ ok: false, holder: 'holder-a' })
  })
})

describe('one delivery per (provider, event id)', () => {
  it('two redeliveries of the same event leave one row, and one claim', async () => {
    fake = seedDb({})
    const { claimDelivery } = await import('../app/lib/zernio-events')
    const [a, b] = await Promise.all([
      claimDelivery('post.published', 'evt-1'),
      claimDelivery('post.published', 'evt-1'),
    ])
    expect([a, b].filter(r => r.kind === 'claimed')).toHaveLength(1)
    expect([a, b].filter(r => r.kind === 'duplicate')).toHaveLength(1)
    expect(fake.rows('webhook_deliveries')).toHaveLength(1)
  })

  it('a different event id is its own claim, and releasing frees the key', async () => {
    fake = seedDb({})
    const { claimDelivery, releaseDelivery } = await import('../app/lib/zernio-events')
    const first = await claimDelivery('post.published', 'evt-1')
    expect((await claimDelivery('post.published', 'evt-2')).kind).toBe('claimed')
    // a delivery answered with a non-2xx gives its claim back, so the
    // provider's retry is handled rather than seen as a duplicate
    await releaseDelivery(first)
    expect((await claimDelivery('post.published', 'evt-1')).kind).toBe('claimed')
  })
})

describe('a stale notification is reclaimed by exactly one retrier', () => {
  const DEDUPE = buildDedupeKey('e', 'item', 'i1', 'a@x.invalid')
  const held = (status: string, createdAt: string): Row => ({
    id: 'n1', dedupe_key: DEDUPE, event_type: 'e', recipient_email: 'a@x.invalid',
    subject: 'S', body_html: '<p>x</p>', entity_type: 'item', entity_id: 'i1',
    channel: 'email', status, created_at: createdAt,
  }) as unknown as Row

  const input = {
    eventType: 'e', entityType: 'item', entityId: 'i1',
    recipientEmail: 'a@x.invalid', subject: 'S', bodyHtml: '<p>x</p>',
  }

  it('sends once when two retriers find the same failed row', async () => {
    fake = seedDb({ notification_log: [held('failed', '2026-01-01T00:00:00.000Z')] })
    fake.tree().mdm.uniq = { notification_log: { dedupe_key: { [encodeKey(DEDUPE)]: 'n1' } } }
    stubTransport()
    const { notify } = await import('../app/lib/mailer')
    const [a, b] = await Promise.all([notify(input), notify(input)])
    expect([a, b].filter(r => r === 'sent')).toHaveLength(1)
    expect([a, b].filter(r => r === 'duplicate')).toHaveLength(1)
    expect(smtpSends).toHaveLength(1)          // one email, not two
  })

  it('a row that is already sent is never reclaimed, and no email leaves', async () => {
    fake = seedDb({ notification_log: [held('sent', '2026-01-01T00:00:00.000Z')] })
    fake.tree().mdm.uniq = { notification_log: { dedupe_key: { [encodeKey(DEDUPE)]: 'n1' } } }
    stubTransport()
    const { notify } = await import('../app/lib/mailer')
    expect(await notify(input)).toBe('duplicate')
    expect(smtpSends).toEqual([])
  })

  it('a row reclaimed between the read and the write is left alone', async () => {
    fake = seedDb({ notification_log: [held('failed', '2026-01-01T00:00:00.000Z')] })
    fake.tree().mdm.uniq = { notification_log: { dedupe_key: { [encodeKey(DEDUPE)]: 'n1' } } }
    stubTransport()
    const off = fake.onBeforeWrite('/mdm/tables/notification_log/n1', () => {
      off()
      fake!.tree().mdm.tables.notification_log.n1.status = 'sent'
    })
    const { notify } = await import('../app/lib/mailer')
    expect(await notify(input)).toBe('duplicate')
    expect(smtpSends).toEqual([])
  })
})

describe('one provider profile per client', () => {
  const client = (): Row => ({ id: 'c1', name: 'Acme', social_profile_id: null }) as unknown as Row

  it('two people pressing connect end up on the SAME profile', async () => {
    fake = seedDb({ clients: [client()] })
    const { connectLinkFor } = await import('../app/lib/social-connect')
    await Promise.all([connectLinkFor('c1', 'instagram'), connectLinkFor('c1', 'instagram')])
    const stored = fake.rows('clients')[0] as unknown as { social_profile_id: string }
    // the loser adopts what is stored rather than overwriting it
    expect(['prof-1', 'prof-2']).toContain(stored.social_profile_id)
    const after = await connectLinkFor('c1', 'instagram')
    expect('authUrl' in after).toBe(true)
    expect(fake.rows('clients')[0]).toMatchObject({ social_profile_id: stored.social_profile_id })
  })

  it('a profile minted between the read and the write is not overwritten', async () => {
    fake = seedDb({ clients: [client()] })
    const off = fake.onBeforeWrite('/mdm/tables/clients/c1', () => {
      off()
      fake!.tree().mdm.tables.clients.c1.social_profile_id = 'theirs'
    })
    const { connectLinkFor } = await import('../app/lib/social-connect')
    await connectLinkFor('c1', 'instagram')
    expect(fake.rows('clients')[0]).toMatchObject({ social_profile_id: 'theirs' })
  })
})

describe('the brand profile rev guard', () => {
  const client = (rev: number | null): Row => ({
    id: 'c1', name: 'Acme',
    brand_profile: rev === null ? null : { rev, tone: 'calm' },
  }) as unknown as Row

  it('a scan folding into a profile that moved underneath it re-merges instead of clobbering', async () => {
    fake = seedDb({ clients: [client(1)] })
    const off = fake.onBeforeWrite('/mdm/tables/clients/c1', () => {
      off()
      // somebody saves an edit first — rev 2, with a colour we must not lose
      fake!.tree().mdm.tables.clients.c1.brand_profile = { rev: 2, colours: [{ hex: '#123456', name: 'Ink', role: '' }] }
    })
    const { applyScanToEditableProfile } = await import('../app/lib/brand-profile')
    const out = await applyScanToEditableProfile('c1', { fonts: [{ family: 'Inter' }] } as never, 'scan')
    const saved = fake.rows('clients')[0] as unknown as { brand_profile: { rev: number; colours?: unknown[] } }
    expect(out).toBe('updated')
    expect(saved.brand_profile.rev).toBe(3)              // built on THEIR version
    expect(saved.brand_profile.colours).toHaveLength(1)  // and it survived
  })

  it('a scan that adds nothing writes nothing', async () => {
    fake = seedDb({ clients: [client(1)] })
    const { applyScanToEditableProfile } = await import('../app/lib/brand-profile')
    expect(await applyScanToEditableProfile('c1', {} as never, 'scan')).toBe('unchanged')
  })
})
