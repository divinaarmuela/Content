import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * Turning a lead into a client, at the duplicate check.
 *
 * The check was a PostgREST `.or(slug.eq.…,email.eq.…)`, and Postgres compares
 * null to null as unknown — so a lead with no email address never matched a
 * client with no email address. In JavaScript `null === null` is true, which
 * would have made every emailless lead "already a client".
 */

vi.mock('../app/lib/authz', () => ({ guard: async () => null }))

const { POST } = await import('../app/api/website/clients/convert-lead/route')

const post = async (body: unknown) => {
  const res = await POST(new Request('https://x.test/api/website/clients/convert-lead', {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  fake = seedDb({
    leads: [
      {
        id: 'lead-1', created_at: '2026-09-01T00:00:00.000Z',
        fname: 'Dana', lname: 'Reyes', biz: 'Fernwood Studio',
        email: null, phone: '0400 000 000',
      },
      {
        id: 'lead-2', created_at: '2026-09-01T00:00:00.000Z',
        fname: 'Sam', lname: 'Ng', biz: 'Harbour Foods',
        email: 'sam@example.invalid', phone: null,
      },
      {
        id: 'lead-3', created_at: '2026-09-01T00:00:00.000Z',
        fname: 'Pat', lname: 'Lee', biz: 'ZZ TEST',
        email: 'pat@example.invalid', phone: null,
      },
    ] as unknown as Row[],
    clients: [
      // an existing client that also has no email on file
      { id: 'client-1', name: 'ZZ TEST', slug: 'zz-test', email: null, share_token: 'tok-1' },
    ] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('POST /api/website/clients/convert-lead', () => {
  it('converts a lead with no email even when a client has no email either', async () => {
    const { status, json } = await post({ lead_id: 'lead-1' })
    expect(status).toBe(201)
    expect(json.name).toBe('Fernwood Studio')
    expect(fake.rows('clients')).toHaveLength(2)
  })

  it('mints the portal token, so the new client has a working front door', async () => {
    await post({ lead_id: 'lead-1' })
    const created = (fake.rows('clients') as unknown as Record<string, unknown>[])
      .find(c => c.slug === 'fernwood-studio')!
    expect(String(created.share_token)).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('still points at the existing client when the email really matches', async () => {
    const { status, json } = await post({ lead_id: 'lead-2' })
    expect(status).toBe(201)
    // no clash yet — but a second run finds the client it just made
    const again = await post({ lead_id: 'lead-2' })
    expect(again.status).toBe(409)
    expect(String(again.json.error)).toContain('Already exists as client')
    expect(again.json.client_id).toBe((json as { id: string }).id)
  })

  it('still points at the existing client when only the slug matches', async () => {
    // a new address, but the same business name as ZZ TEST
    const { status, json } = await post({ lead_id: 'lead-3' })
    expect(status).toBe(409)
    expect(json.client_id).toBe('client-1')
    expect(fake.rows('clients')).toHaveLength(1)
  })

  it('404s a lead that is not there', async () => {
    const { status, json } = await post({ lead_id: 'nope' })
    expect(status).toBe(404)
    expect(json.error).toBe('Lead not found')
  })
})
