import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  base64UrlDecode, base64UrlEncode, confirmationCodeFor, isConfirmationCode, parseSignedRequest, statusUrl, statusWords,
} from '../app/lib/meta-signed-request-core'

/* ── Meta's Data Deletion Request Callback: the signed request (30 Sep 2026) ── */

const SECRET = 'test-app-secret'

/** build a signed request exactly as Meta does: sig over the ENCODED payload */
function sign(payload: unknown, secret = SECRET): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(encodedPayload).digest()
  return `${base64UrlEncode(sig)}.${encodedPayload}`
}

describe('parseSignedRequest', () => {
  it('accepts a valid request and reads the user id', () => {
    const r = parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', issued_at: 1759200000, user_id: '1234567890' }), SECRET)
    expect(r).toMatchObject({ ok: true, payload: { user_id: '1234567890', algorithm: 'HMAC-SHA256' } })
  })

  it('accepts the algorithm in any case, as Meta\'s samples do', () => {
    expect(parseSignedRequest(sign({ algorithm: 'hmac-sha256', user_id: '42' }), SECRET).ok).toBe(true)
  })

  it('reads a numeric user id as text', () => {
    const r = parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: 42 }), SECRET)
    expect(r.ok && r.payload.user_id).toBe('42')
  })

  it('refuses a request signed with another secret', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'someone-else'), SECRET))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses a payload changed after signing', () => {
    const good = sign({ algorithm: 'HMAC-SHA256', user_id: '1' })
    const [sig] = good.split('.')
    const forged = `${sig}.${base64UrlEncode(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '2' }))}`
    expect(parseSignedRequest(forged, SECRET)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses a truncated signature without throwing', () => {
    const [sig, body] = sign({ algorithm: 'HMAC-SHA256', user_id: '1' }).split('.')
    expect(parseSignedRequest(`${sig.slice(0, 10)}.${body}`, SECRET)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('refuses the wrong algorithm, and a missing one', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA1', user_id: '1' }), SECRET)).toEqual({ ok: false, reason: 'wrong_algorithm' })
    expect(parseSignedRequest(sign({ user_id: '1' }), SECRET)).toEqual({ ok: false, reason: 'wrong_algorithm' })
  })

  it('refuses malformed input', () => {
    for (const bad of [undefined, null, 42, '', 'no-dot', 'a.b.c', '.x', 'x.', '!!!.???', `${base64UrlEncode('sig')}.${base64UrlEncode('not json')}`, `${base64UrlEncode('sig')}.${base64UrlEncode('[1,2]')}`]) {
      expect(parseSignedRequest(bad, SECRET)).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('refuses a signed request with no user id', () => {
    expect(parseSignedRequest(sign({ algorithm: 'HMAC-SHA256', user_id: '  ' }), SECRET)).toEqual({ ok: false, reason: 'no_user' })
  })

  it('refuses everything while the app secret is not set', () => {
    const good = sign({ algorithm: 'HMAC-SHA256', user_id: '1' })
    expect(parseSignedRequest(good, undefined)).toEqual({ ok: false, reason: 'missing_secret' })
    expect(parseSignedRequest(good, '')).toEqual({ ok: false, reason: 'missing_secret' })
  })
})

describe('confirmation codes', () => {
  it('are stable for one signed request (a redelivery records once) and differ between requests', () => {
    const a = sign({ algorithm: 'HMAC-SHA256', user_id: '1', issued_at: 1 })
    const b = sign({ algorithm: 'HMAC-SHA256', user_id: '1', issued_at: 2 })
    expect(confirmationCodeFor(a)).toBe(confirmationCodeFor(a))
    expect(confirmationCodeFor(a)).not.toBe(confirmationCodeFor(b))
    expect(isConfirmationCode(confirmationCodeFor(a))).toBe(true)
  })

  it('only a 16-character lowercase hex code passes, so nothing else reaches a database path', () => {
    for (const bad of ['', 'abc', '0123456789ABCDEF', '0123456789abcdeg', '../../mdm/tables', '0123456789abcdef0', null, 7]) {
      expect(isConfirmationCode(bad)).toBe(false)
    }
    expect(isConfirmationCode('0123456789abcdef')).toBe(true)
  })

  it('build the status link Meta shows the person', () => {
    expect(statusUrl('0123456789abcdef')).toBe('https://app.mdmmarketing.com.au/data-deletion/status?code=0123456789abcdef')
  })

  it('have words for every status, and an unknown one never claims completion', () => {
    expect(statusWords('completed').label).toBe('Completed')
    expect(statusWords('whatever').label).toBe('Received')
  })
})

describe('base64url', () => {
  it('round-trips and rejects characters outside the alphabet', () => {
    expect(base64UrlDecode(base64UrlEncode('héllo?>'))!.toString('utf8')).toBe('héllo?>')
    expect(base64UrlDecode('a+b/')).toBeNull()
  })
})
