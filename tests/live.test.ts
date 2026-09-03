import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'

/**
 * `after()` only exists inside a request scope. Outside one — an Inngest
 * function, a script, this test suite — Next throws, and `announceAfter` has
 * to fall back to the plain fire-and-forget PUT rather than losing the
 * marker. That is the branch mocked here.
 */
const afterCalls: (() => unknown)[] = []
let afterThrows = true
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (afterThrows) throw new Error('`after` was called outside a request scope')
    afterCalls.push(fn)
  },
}))

const { announce, announceAfter } = await import('@/lib/live')

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb() })
afterEach(() => fake.restore())

describe('announce', () => {
  it('PUTs the hint with a ts to /mdm/live/<channel> and never throws', async () => {
    announce('production', { item_id: 'i1', client_id: 'c1', status: 'draft', kind: 'updated' })
    await new Promise(r => setTimeout(r, 0))
    const node = fake.tree().mdm.live.production
    expect(node.item_id).toBe('i1')
    expect(typeof node.ts).toBe('number')
  })
  it('swallows transport failures — the returned promise resolves, never rejects', async () => {
    fake.restore()
    globalThis.fetch = (async () => { throw new Error('down') }) as any
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = 'https://fake.firebasedatabase.app'
    await expect(announce('leads', { id: 'x' })).resolves.toBeUndefined()
  })
})

describe('announceAfter', () => {
  afterEach(() => { afterThrows = true; afterCalls.length = 0 })

  it('falls back to a direct announce when there is no request scope for `after`', async () => {
    afterThrows = true
    announceAfter('production', { item_id: 'i2', kind: 'updated' })
    await new Promise(r => setTimeout(r, 0))
    expect(fake.tree().mdm.live.production.item_id).toBe('i2')
  })

  it('inside a request, hands the marker to `after` instead of racing the response', async () => {
    afterThrows = false
    announceAfter('production', { item_id: 'i3', kind: 'updated' })
    // nothing written yet — the platform runs it after the response
    expect(fake.tree().mdm?.live?.production).toBeUndefined()
    expect(afterCalls).toHaveLength(1)
    await afterCalls[0]()
    expect(fake.tree().mdm.live.production.item_id).toBe('i3')
  })
})
