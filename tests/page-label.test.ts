import { describe, expect, it } from 'vitest'
import { pageLabel } from '../app/lib/calendly-core'

describe('Booked from: ad landing page vs menu page', () => {
  it('tells them apart', () => {
    expect(pageLabel('/landing/strategy')).toBe('Strategy (ad page)')
    expect(pageLabel('/services/strategy')).toBe('Strategy')
    expect(pageLabel('/landing/custom-websites')).toBe('Custom websites (ad page)')
    expect(pageLabel('/')).toBe('Home')
  })
})
