import { describe, expect, it } from 'vitest'
import { HOLD_MS, jumpedUp } from '../app/lib/hold-page-scroll'

describe('typing on the board never throws the page up (Manal, 20 Oct 2026)', () => {
  it('a move up the page is put back', () => {
    expect(jumpedUp(2856, 0)).toBe(true)
    expect(jumpedUp(2856, 2400)).toBe(true)
  })
  it('a move down — the caret going below the screen — is let through, and a pixel is nothing', () => {
    expect(jumpedUp(2856, 2900)).toBe(false)
    expect(jumpedUp(2856, 2856)).toBe(false)
    expect(jumpedUp(2856, 2855.5)).toBe(false)
  })
  it('watches only the moment after a keystroke', () => {
    expect(HOLD_MS).toBeGreaterThan(0)
    expect(HOLD_MS).toBeLessThanOrEqual(500)
  })
})
