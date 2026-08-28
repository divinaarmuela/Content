import { describe, it, expect, vi } from 'vitest'
import { createCoalescer } from '../app/lib/coalesce-core'

describe('createCoalescer — many edits, one save', () => {
  it('coalesces rapid pushes into a single save of the LATEST value', () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const c = createCoalescer<string>(v => saved.push(v), 600)
    c.push('a')
    vi.advanceTimersByTime(200)
    c.push('ab')
    vi.advanceTimersByTime(200)
    c.push('abc')
    // still inside the quiet period — nothing saved yet
    expect(saved).toEqual([])
    vi.advanceTimersByTime(600)
    expect(saved).toEqual(['abc'])
    vi.useRealTimers()
  })

  it('flush saves the pending value immediately, and only once', () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const c = createCoalescer<string>(v => saved.push(v), 600)
    c.push('x')
    c.flush()
    expect(saved).toEqual(['x'])
    // the timer is gone — nothing fires again later
    vi.advanceTimersByTime(2000)
    expect(saved).toEqual(['x'])
    // a flush with nothing pending is a no-op
    c.flush()
    expect(saved).toEqual(['x'])
    vi.useRealTimers()
  })

  it('cancel drops the pending value without saving', () => {
    vi.useFakeTimers()
    const saved: string[] = []
    const c = createCoalescer<string>(v => saved.push(v), 600)
    c.push('doomed')
    c.cancel()
    vi.advanceTimersByTime(2000)
    expect(saved).toEqual([])
    vi.useRealTimers()
  })

  it('a push after a save starts a fresh cycle', () => {
    vi.useFakeTimers()
    const saved: number[] = []
    const c = createCoalescer<number>(v => saved.push(v), 600)
    c.push(1)
    vi.advanceTimersByTime(600)
    c.push(2)
    vi.advanceTimersByTime(600)
    expect(saved).toEqual([1, 2])
    vi.useRealTimers()
  })
})
