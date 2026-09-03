import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installFakeRtdb } from './helpers/fake-rtdb'
import { announceItemChange, announceBatchChange, announceBookingChange } from '@/app/lib/production-live'

let fake: ReturnType<typeof installFakeRtdb>
beforeEach(() => { fake = installFakeRtdb() })
afterEach(() => fake.restore())
const flush = () => new Promise(r => setTimeout(r, 0))

describe('production-live', () => {
  it('item, batch and booking changes all land on /mdm/live/production', async () => {
    announceItemChange({ item_id: 'i1', client_id: 'c1', status: 'draft', kind: 'updated' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('i1')
    announceBatchChange({ batch_id: 'b1', client_id: 'c1', status: 'open', kind: 'updated' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('batch:b1')
    announceBookingChange({ booking_id: 'k1', kind: 'moved' }); await flush()
    expect(fake.tree().mdm.live.production.item_id).toBe('booking:k1')
  })
})
