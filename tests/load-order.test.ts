import { describe, expect, it } from 'vitest'
import { LoadOrder } from '../app/lib/load-order'

describe('LoadOrder', () => {
  it('applies a lone answer', () => {
    const o = new LoadOrder<string>()
    const a = o.begin()
    expect(o.settle(a, 'one')).toEqual({ apply: true, value: 'one' })
  })

  it('a stale answer that arrives after a fresher one is dropped', () => {
    const o = new LoadOrder<string>()
    const poll = o.begin()
    const save = o.begin()
    expect(o.settle(save, 'after save')).toEqual({ apply: true, value: 'after save' })
    // the poll was issued BEFORE the save and answers after it — the old item
    expect(o.settle(poll, 'before save').apply).toBe(false)
  })

  it('holds a fresh answer while a newer request is still in flight', () => {
    const o = new LoadOrder<string>()
    const first = o.begin()
    const second = o.begin()
    expect(o.settle(first, 'transition done').apply).toBe(false)
    expect(o.settle(second, 'realtime')).toEqual({ apply: true, value: 'realtime' })
  })

  it('THE BUG: a newer request that never applies releases the held answer', () => {
    const o = new LoadOrder<string>()
    const transition = o.begin()
    const realtime = o.begin()
    // the post-transition answer arrives while the realtime refetch is open
    expect(o.settle(transition, 'approved').apply).toBe(false)
    // …and that refetch dies. The fresh answer must still reach the screen.
    expect(o.fail(realtime)).toEqual({ apply: true, value: 'approved' })
  })

  it('releases only the freshest held answer, once', () => {
    const o = new LoadOrder<string>()
    const a = o.begin()
    const b = o.begin()
    const c = o.begin()
    expect(o.settle(a, 'a').apply).toBe(false)
    expect(o.settle(b, 'b').apply).toBe(false)
    expect(o.fail(c)).toEqual({ apply: true, value: 'b' })
    // nothing left to release
    expect(o.fail(c).apply).toBe(false)
  })

  it('a failure with nothing held changes nothing', () => {
    const o = new LoadOrder<string>()
    const a = o.begin()
    expect(o.fail(a).apply).toBe(false)
    const b = o.begin()
    expect(o.settle(b, 'b')).toEqual({ apply: true, value: 'b' })
  })

  it('an answer older than what is already on screen never wins, even held', () => {
    const o = new LoadOrder<string>()
    const old = o.begin()
    const newer = o.begin()
    const newest = o.begin()
    expect(o.settle(newest, 'newest')).toEqual({ apply: true, value: 'newest' })
    expect(o.settle(old, 'old').apply).toBe(false)
    expect(o.fail(newer).apply).toBe(false)
  })
})
