import { describe, it, expect } from 'vitest'
import { fatalApiReason } from '../app/lib/scan-core'

/** Which Anthropic failures should abort a whole scan versus fail one message.
 *  Getting this wrong is expensive in both directions: treat a transient blip
 *  as fatal and one bad email stops the run; treat a billing failure as
 *  per-message and every email in the inbox is logged as an error. */
describe('fatalApiReason', () => {
  it('treats an exhausted credit balance as fatal, and says how to fix it', () => {
    const reason = fatalApiReason(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    )
    expect(reason).toMatch(/out of credit/i)
    expect(reason).toMatch(/Plans & Billing/i)
  })

  it('treats a rejected key as fatal', () => {
    expect(fatalApiReason(Object.assign(new Error('nope'), { status: 401 }))).toMatch(/API key was rejected/i)
    expect(fatalApiReason(new Error('invalid x-api-key'))).toMatch(/API key was rejected/i)
  })

  it('treats a model permission failure as fatal', () => {
    expect(fatalApiReason(Object.assign(new Error('denied'), { status: 403 }))).toMatch(/not permitted/i)
  })

  it('treats rate limiting as fatal for this run, and invites a retry', () => {
    expect(fatalApiReason(Object.assign(new Error('slow down'), { status: 429 }))).toMatch(/rate limit/i)
  })

  it('lets ordinary per-message failures through as non-fatal', () => {
    expect(fatalApiReason(new Error('Classification returned no parseable output'))).toBeNull()
    expect(fatalApiReason(new Error('socket hang up'))).toBeNull()
    expect(fatalApiReason(Object.assign(new Error('server error'), { status: 500 }))).toBeNull()
    expect(fatalApiReason(undefined)).toBeNull()
  })
})
