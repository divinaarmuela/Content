import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { base64UrlEncode } from '../app/lib/meta-signed-request-core'

/* ── POST /api/meta/data-deletion: records, never deletes, never emails (30 Sep 2026) ── */

type R = { id: string } & Record<string, unknown>
const tables = new Map<string, Map<string, R>>()
const tbl = (n: string) => { if (!tables.has(n)) tables.set(n, new Map()); return tables.get(n)! }
const touched: string[] = []

vi.mock('@/lib/db', () => ({
  withRequestCache: (f: () => unknown) => f(),
  table: (name: string) => ({
    claim: async (id: string, mutate: (cur: R | null) => R | null) => {
      touched.push(name)
      const cur = tbl(name).get(id) ?? null
      const next = mutate(cur)
      if (next === null) return { claimed: false, current: cur }
      tbl(name).set(id, next)
      return { claimed: true, row: next }
    },
  }),
}))
// the route must never reach the mailer; if it imports it, this fails loudly
vi.mock('../app/lib/mailer', () => { throw new Error('the deletion callback must not send email') })

const SECRET = 'app-secret'
function sign(payload: unknown, secret = SECRET) {
  const body = base64UrlEncode(JSON.stringify(payload))
  return `${base64UrlEncode(createHmac('sha256', secret).update(body).digest())}.${body}`
}
function post(signed: string) {
  return new NextRequest('https://app.mdmmarketing.com.au/api/meta/data-deletion', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ signed_request: signed }).toString(),
  })
}

beforeEach(() => { tables.clear(); touched.length = 0 })
afterEach(() => { vi.unstubAllEnvs() })

describe('the data deletion callback', () => {
  it('answers 503 and records nothing while META_APP_SECRET is unset', async () => {
    vi.stubEnv('META_APP_SECRET', '')
    const { POST } = await import('../app/api/meta/data-deletion/route')
    const res = await POST(post(sign({ algorithm: 'HMAC-SHA256', user_id: '1' })))
    expect(res.status).toBe(503)
    expect(touched).toEqual([])
  })

  it('records a valid request once and answers Meta\'s shape', async () => {
    vi.stubEnv('META_APP_SECRET', SECRET)
    const { POST } = await import('../app/api/meta/data-deletion/route')
    const signed = sign({ algorithm: 'HMAC-SHA256', user_id: '9876', issued_at: 1759200000 })
    const res = await POST(post(signed))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.confirmation_code).toMatch(/^[a-f0-9]{16}$/)
    expect(body.url).toBe(`https://app.mdmmarketing.com.au/data-deletion/status?code=${body.confirmation_code}`)
    const rows = [...tbl('data_deletion_requests').values()]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: body.confirmation_code, meta_user_id: '9876', status: 'received' })

    // Meta redelivers the same callback: same code, still one row, first row untouched
    const again = await (await POST(post(signed))).json()
    expect(again.confirmation_code).toBe(body.confirmation_code)
    expect(tbl('data_deletion_requests').size).toBe(1)
    expect(tbl('data_deletion_requests').get(body.confirmation_code)!.received_at).toBe(rows[0].received_at)
  })

  it('refuses a bad signature with 401 and a malformed request with 400, recording nothing', async () => {
    vi.stubEnv('META_APP_SECRET', SECRET)
    const { POST } = await import('../app/api/meta/data-deletion/route')
    expect((await POST(post(sign({ algorithm: 'HMAC-SHA256', user_id: '1' }, 'other')))).status).toBe(401)
    expect((await POST(post('garbage'))).status).toBe(400)
    expect(tbl('data_deletion_requests').size).toBe(0)
  })

  it('touches only its own table', async () => {
    vi.stubEnv('META_APP_SECRET', SECRET)
    const { POST } = await import('../app/api/meta/data-deletion/route')
    await POST(post(sign({ algorithm: 'HMAC-SHA256', user_id: '5' })))
    expect(new Set(touched)).toEqual(new Set(['data_deletion_requests']))
  })
})

describe('the Meta review pages stay public', () => {
  const mw = readFileSync(join(__dirname, '..', 'middleware.ts'), 'utf8')
  it('no protected pattern or matcher entry covers them', () => {
    // the pages and the three routes Meta itself calls stay public; the signed-in Meta routes
    // (/api/meta/instagram/connect, accounts, subscribe — 1 Oct 2026) are gated on purpose
    for (const p of ['/privacy', '/terms', '/data-deletion', '/app-info', '/support', '/api/meta/data-deletion', '/api/meta/webhook', '/api/meta/instagram/callback']) {
      expect(mw).not.toMatch(new RegExp(`'${p.replace(/\//g, '\\/')}[(/:']`))
    }
    // and no catch-all covers the whole /api/meta tree
    expect(mw).not.toMatch(/'\/api\/meta(\(\.\*\))?'/)
  })
})
