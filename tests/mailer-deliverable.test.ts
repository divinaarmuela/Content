import { describe, it, expect } from 'vitest'
import { deliverable } from '../app/lib/mailer'

describe('test addresses never reach SMTP2GO (4 Nov 2026: 205 bounces)', () => {
  it('drops .invalid addresses, keeps real ones', () => {
    expect(deliverable(['test-am@mdmedia-test.invalid', 'a@b.com', 'X <test-qc@mdmedia-test.INVALID>'])).toEqual(['a@b.com'])
  })
})
