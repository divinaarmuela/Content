import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { clients as hardcoded } from '../app/components/lama/workData'

/**
 * The one-time workData import. Its whole promise is "safe to run again", and
 * the interesting case is the second run: it must not undo anything a person
 * did to a client in between.
 */

vi.mock('../app/lib/authz', () => ({ guard: async () => null }))

let fake: ReturnType<typeof seedDb> | null = null
afterEach(() => { fake?.restore(); fake = null })

const first = hardcoded[0]

describe('POST /api/website/seed', () => {
  it('leaves an archived client archived when it runs again', async () => {
    fake = seedDb({
      clients: [{
        id: 'c-1', slug: first.slug, name: first.name, industry: first.industry,
        status: 'archived',
      }] as unknown as Row[],
      // the project row is absent, so this slug is one the seed still wants to create
    })
    const { POST } = await import('../app/api/website/seed/route')
    const res = await POST()
    expect(res.status).toBe(200)

    const client = fake.rows('clients').find(r => (r as { slug?: string }).slug === first.slug)
    expect((client as { status?: string }).status).toBe('archived')
    // …and it did create the project it was there to create
    expect(fake.rows('projects').some(r => (r as { slug?: string }).slug === first.slug)).toBe(true)
  })

  it('mints status active for a client it creates itself', async () => {
    fake = seedDb({})
    const { POST } = await import('../app/api/website/seed/route')
    await POST()
    const client = fake.rows('clients').find(r => (r as { slug?: string }).slug === first.slug)
    expect((client as { status?: string }).status).toBe('active')
  })

  it('skips a slug that already has a project', async () => {
    fake = seedDb({
      projects: [{ id: 'p-1', slug: first.slug, name: 'Hand edited' }] as unknown as Row[],
    })
    const { POST } = await import('../app/api/website/seed/route')
    const body = await (await POST()).json()
    expect(body.created).toBe(hardcoded.length - 1)
    expect(fake.rows('projects').filter(r => (r as { slug?: string }).slug === first.slug))
      .toHaveLength(1)
  })
})
