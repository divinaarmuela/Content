import { describe, expect, it } from 'vitest'
import { withTimeout } from '../app/lib/wait-core'

describe('withTimeout — a wait with an end (9 Sep 2026)', () => {
  it('hands back the answer when it comes in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, 'x')).resolves.toBe(42)
  })
  it('gives up with a sentence when it does not', async () => {
    const never = new Promise<number>(() => {})
    await expect(withTimeout(never, 10, 'The cover upload')).rejects.toThrow(/The cover upload is taking too long/)
  })
  it('passes a failure straight through', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 50, 'x')).rejects.toThrow('nope')
  })
})
