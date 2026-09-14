import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AN EMAIL STARTED AS THE RESPONSE LEFT MUST STILL BE SENT.
 *
 * The transition emails ran as a promise nobody awaited, started as the
 * write returned. On a serverless platform the function is frozen once its
 * response is out, and the promise with it — the owner's quality checker
 * heard nothing (14 Sep 2026). Inside a request the work is handed to
 * Next's `after()`, which keeps the function alive for it; outside one
 * (a test, a script) `after()` throws at once and the work runs detached.
 */
const h = vi.hoisted(() => ({ afterThrows: true, handed: [] as (() => unknown)[] }))

vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    if (h.afterThrows) throw new Error('`after` was called outside a request scope')
    h.handed.push(fn)
  },
}))

const { afterResponse } = await import('../app/lib/after-response')

beforeEach(() => { h.handed = [] })
afterEach(() => { vi.restoreAllMocks() })

describe('afterResponse', () => {
  it('inside a request the work is handed to after(), not started at once', async () => {
    h.afterThrows = false
    let ran = 0
    afterResponse('x', async () => { ran += 1 })
    expect(ran).toBe(0)
    expect(h.handed).toHaveLength(1)
    await h.handed[0]()
    expect(ran).toBe(1)
  })

  it('outside a request the work runs detached, as it always did', async () => {
    h.afterThrows = true
    let ran = 0
    afterResponse('x', async () => { ran += 1 })
    expect(h.handed).toHaveLength(0)
    await new Promise(r => setTimeout(r, 0))
    expect(ran).toBe(1)
  })

  it('a failure is logged under its label and never thrown', async () => {
    h.afterThrows = true
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => afterResponse('the fan-out', async () => { throw new Error('smtp down') })).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
    expect(err).toHaveBeenCalledWith('the fan-out error:', expect.any(Error))
  })
})

describe('every notification in the workflow module goes through it', () => {
  it('no bare fire-and-forget promise is left', () => {
    const src = readFileSync(join(__dirname, '..', 'app', 'lib', 'workflow.ts'), 'utf8')
    expect(src).not.toContain('void (async () => {')
    expect(src).not.toMatch(/void notify\w+\(/)
    expect(src).toContain("afterResponse('notification fan-out', async () => {")
    expect(src).toContain("afterResponse('stand-in pass notification'")
  })
})
