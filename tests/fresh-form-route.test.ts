import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import type { TemplateDefinition } from '../app/lib/intake-core'

/**
 * A form nobody has typed into yet must open.
 *
 * `createIntakeForm` / `createMonthlyForm` write `answers: {}`, and the
 * Realtime Database stores no empty object — so the row read back has no
 * `answers` key at all. Every reader indexed straight into it and the public
 * link, plus the dashboard's own intake and monthly panels, 500'd until the
 * first autosave. The tree seeded below is deliberately missing `answers`:
 * that is exactly what the database hands back.
 */

vi.mock('@/lib/live', () => ({ announceAfter: () => {}, announce: async () => {} }))

const DEF = {
  key: 'one_off',
  name: 'Test form',
  sections: [{
    id: 's1',
    title: 'About you',
    blocks: [
      { id: 'public_name', type: 'short_text', label: 'Your name' },
      { id: 'why', type: 'guidance', label: 'Why we ask' },
      { id: 'socials', type: 'short_text', label: 'Socials' },
    ],
  }],
} as unknown as TemplateDefinition

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  fake = seedDb({
    clients: [{ id: 'c1', name: 'ZZ TEST' }] as unknown as Row[],
    // NOTE: no `answers` key on either row — the fresh-form shape.
    intake_forms: [{
      id: 'f1', client_id: 'c1', token: 'tok-intake', status: 'draft',
      template_key: 'one_off', definition: DEF, send_copy_to_client: false,
    }] as unknown as Row[],
    monthly_updates: [{
      id: 'm1', client_id: 'c1', token: 'tok-monthly', status: 'draft',
      month: 12, year: 2099, title: 'December 2099', definition: DEF,
    }] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('a freshly created form opens', () => {
  it('GET /api/intake/[token] is 200 with 0% completion, not a 500', async () => {
    const { GET } = await import('../app/api/intake/[token]/route')
    const res = await GET(new Request('https://x.test/api/intake/tok-intake') as never, {
      params: Promise.resolve({ token: 'tok-intake' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { answers: unknown; completion: { answered: number; total: number } }
    expect(body.completion).toMatchObject({ answered: 0, total: 2 })
    expect(body.answers).toEqual({})   // restored by normalise(), not undefined
  })

  it('GET /api/monthly/[token] is 200 with 0% completion, not a 500', async () => {
    const { GET } = await import('../app/api/monthly/[token]/route')
    const res = await GET(new Request('https://x.test/api/monthly/tok-monthly') as never, {
      params: Promise.resolve({ token: 'tok-monthly' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { answers: unknown; completion: { answered: number } }
    expect(body.completion).toMatchObject({ answered: 0, total: 2 })
    expect(body.answers).toEqual({})
  })
})

describe('submitMonthly is a claim', () => {
  it('two concurrent submits produce exactly one winner', async () => {
    const { submitMonthly } = await import('../app/lib/monthly')
    const [a, b] = await Promise.all([submitMonthly('tok-monthly'), submitMonthly('tok-monthly')])
    expect(a?.status).toBe('submitted')
    expect(b?.status).toBe('submitted')
    // one submitted_at, written once — both callers see the same instant
    const row = fake.rows('monthly_updates')[0] as unknown as { status: string; submitted_at: string }
    expect(row.status).toBe('submitted')
    expect([a!.submitted_at, b!.submitted_at]).toContain(row.submitted_at)
    expect(a!.submitted_at).toBe(b!.submitted_at)
  })

  it('a later submit is refused and returns the already-submitted form', async () => {
    const { submitMonthly } = await import('../app/lib/monthly')
    const first = await submitMonthly('tok-monthly')
    const second = await submitMonthly('tok-monthly')
    expect(second?.submitted_at).toBe(first?.submitted_at)
  })

  it('an unknown token is null, not a throw', async () => {
    const { submitMonthly } = await import('../app/lib/monthly')
    expect(await submitMonthly('nope')).toBeNull()
  })
})
