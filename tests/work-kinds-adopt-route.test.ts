import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { findKindByName, kindSlugOf, normaliseKindName } from '../app/lib/work-kinds-core'

/**
 * FREE-TEXT KINDS: typing a kind that does not exist creates it, and typing
 * one that does adopts it. Against the real `@/lib/db` on the in-memory
 * database, because the whole guarantee is the unique slug the database
 * enforces — a mock of the table would prove nothing.
 */

const h = vi.hoisted(() => ({
  user: { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null },
}))

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => h.user,
  requireSignedIn: async () => h.user,
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error',
    status: (e as { status?: number })?.status ?? 500,
  }),
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(async () => {}) }))

const { POST } = await import('../app/api/production/work-kinds/adopt/route')

const post = async (name: unknown) => {
  const res = await POST(new Request('https://x.test/api/production/work-kinds/adopt', {
    method: 'POST', body: JSON.stringify({ name }),
  }))
  return { status: res.status, json: await res.json() as any }
}

const KINDS = [
  { id: 'wk-edit', slug: 'edit', name: 'Video edit', uses_media: true, active: true, sort_order: 0, color: 'zinc', default_roles: ['editor'] },
  { id: 'wk-old', slug: 'voiceover', name: 'Voiceover', uses_media: true, active: false, sort_order: 1, color: 'zinc', default_roles: ['editor'] },
]

let fake: ReturnType<typeof seedDb>
beforeEach(() => { fake = seedDb({ work_kinds: KINDS as unknown as Row[] }) })
afterEach(() => fake.restore())

describe('the pure half', () => {
  it('"Odd Job" and "odd job" are one kind', () => {
    expect(normaliseKindName('  Odd   Job ')).toBe('Odd Job')
    expect(kindSlugOf('Odd Job')).toBe('odd_job')
    expect(kindSlugOf('odd job')).toBe('odd_job')
    expect(kindSlugOf('ODD-JOB!')).toBe('odd_job')
  })
  it('slugs are safe characters only, bounded, never empty, never reserved', () => {
    expect(kindSlugOf('Café menu / photos')).toBe('cafe_menu_photos')
    expect(kindSlugOf('🎬🎬🎬')).toBe('kind')
    expect(kindSlugOf('x'.repeat(100))).toHaveLength(40)
    expect(kindSlugOf('Shoot Brief')).toBe('shoot_brief_2')
    for (const s of ['a b', 'A_B', 'a--b', '  a  b  ']) expect(kindSlugOf(s)).toMatch(/^[a-z0-9_]+$/)
  })
  it('finds an existing kind by slug, or by name ignoring case and spacing', () => {
    expect(findKindByName(KINDS, 'video edit')?.id).toBe('wk-edit')
    expect(findKindByName(KINDS, 'Edit')?.id).toBe('wk-edit')
    expect(findKindByName(KINDS, 'VIDEO   EDIT')?.id).toBe('wk-edit')
    expect(findKindByName(KINDS, 'Reel')).toBeNull()
  })
})

describe('POST /api/production/work-kinds/adopt', () => {
  it('creates a kind that does not exist, with a slug from the name', async () => {
    const r = await post('Odd Job')
    expect(r.status).toBe(201)
    expect(r.json.created).toBe(true)
    expect(r.json.kind).toMatchObject({ name: 'Odd Job', slug: 'odd_job', active: true, uses_media: true })
    expect(fake.rows('work_kinds')).toHaveLength(3)
  })

  it('"Odd Job" then "odd job" is one row, adopted the second time', async () => {
    const first = await post('Odd Job')
    const second = await post('odd job')
    expect(second.status).toBe(200)
    expect(second.json.created).toBe(false)
    expect(second.json.kind.id).toBe(first.json.kind.id)
    expect(fake.rows('work_kinds')).toHaveLength(3)
  })

  it('adopts an existing kind by its display name', async () => {
    const r = await post('video edit')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ created: false, kind: { id: 'wk-edit' } })
    expect(fake.rows('work_kinds')).toHaveLength(2)
  })

  it('brings an archived kind back rather than duplicating it', async () => {
    const r = await post('Voiceover')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ created: false, revived: true, kind: { id: 'wk-old', active: true } })
    expect(fake.rows('work_kinds')).toHaveLength(2)
  })

  it('two racing requests create one row', async () => {
    // the rival's insert lands between this request's lookup and its own
    // insert: the fake's uniq claim refuses the second, and the route adopts
    const off = fake.onBeforeWrite('/mdm', () => {
      off()
      const t = fake.tree().mdm
      t.tables.work_kinds['wk-rival'] = {
        id: 'wk-rival', slug: 'odd_job', name: 'odd job', active: true,
        uses_media: true, color: 'zinc', default_roles: ['editor'], sort_order: 2,
      }
      t.uniq = { work_kinds: { slug: { odd_job: 'wk-rival' } } }
    })
    const r = await post('Odd Job')
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ created: false, kind: { id: 'wk-rival', slug: 'odd_job' } })
    expect(fake.rows('work_kinds').filter(k => (k as { slug?: string }).slug === 'odd_job')).toHaveLength(1)
  })

  it('refuses an empty name in plain words', async () => {
    const r = await post('   ')
    expect(r.status).toBe(400)
    expect(r.json.error).toBe('Type a kind of work first')
  })
})
