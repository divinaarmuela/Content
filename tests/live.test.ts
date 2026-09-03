import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { announce } from '@/lib/live'

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
