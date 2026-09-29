import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'
import { clientFrozenFor, frozenFilesForClient, readClientFrozen } from '../app/lib/edit-freeze-core'

/**
 * WHAT THE CLIENT WAS GIVEN, FROZEN (P7; SPEC §2.6; audit P1). The portal's
 * edit page read the card's LIVE files, so a file added after the send reached
 * the client, and what the email invited them to review could not be
 * reconstructed (live: 411da9a1, 23 Sep 2026). The move to With client now
 * writes `client_frozen` in the same claim. The pure half first, then the real
 * transition route on the in-memory database.
 */

const f = (id: string, version: number, extra: Record<string, unknown> = {}) => ({
  id, name: `${id}.mp4`, url: `https://r2.example/${id}.mp4`, mime: 'video/mp4', size: 10, version, uploaded_at: `2026-09-2${version}T00:00:00Z`, ...extra,
})

describe('clientFrozenFor — the pure freeze', () => {
  it('freezes the newest file of each asset at the card\'s round, minus the dropped ones', () => {
    const card = {
      edit_round: 2,
      final_files: [
        f('a1', 1), f('b1', 1),
        f('a2', 2, { asset_id: 'a1', replaces: 'a1' }), // clip A replaced in round 2
        f('c1', 1, { retired_round: 2 }), // clip C dropped from round 2
        f('d3', 3), // a round-3 file is not the client's yet
      ],
    }
    const frozen = clientFrozenFor(card, '2026-09-29T01:00:00.000Z')
    expect(frozen.round).toBe(2)
    expect(frozen.at).toBe('2026-09-29T01:00:00.000Z')
    expect(frozen.files.map(x => [x.id, x.asset_id, x.version])).toEqual([['a2', 'a1', 2], ['b1', 'b1', 1]])
    expect(frozen.link).toBeNull()
  })
  it('keeps a finished link, but not a posting job\'s folder', () => {
    expect(clientFrozenFor({ link_url: 'https://drive.example/edit', link_kind: 'drive' }, 't').link).toEqual({ url: 'https://drive.example/edit', kind: 'drive' })
    expect(clientFrozenFor({ link_url: 'https://drive.example/folder', raw_assets_url: 'https://drive.example/folder' }, 't').link).toBeNull()
  })
  it('reads back what the database stores, and refuses a freeze of another round', () => {
    const frozen = clientFrozenFor({ edit_round: 1, final_files: [f('a1', 1)] }, '2026-09-29T01:00:00.000Z')
    // the Realtime Database hands arrays back as keyed objects
    const stored = { ...frozen, files: { 0: frozen.files[0] } }
    expect(readClientFrozen(stored)).toEqual(frozen)
    expect(frozenFilesForClient({ client_frozen: stored, client_round: 1 })?.map(x => x.id)).toEqual(['a1'])
    expect(frozenFilesForClient({ client_frozen: stored, client_round: 2 })).toBeNull()
    expect(frozenFilesForClient({ client_frozen: null, client_round: 1 })).toBeNull()
    expect(readClientFrozen({ round: 1, at: 't', files: [{ id: 'x', url: 'http://not-https' }] })?.files).toEqual([])
  })
})

/* ── the real move, on the in-memory database ───────────────────────────── */

const ITEM = 'aaaaaaaa-0000-4000-8000-0000000000f1'
const JOY = { id: 'u-joy', role: 'account_manager', email: 'joy@x.invalid', name: 'Joy', clerk_user_id: null, quality_reviewer: true }

const h = vi.hoisted(() => ({ user: null as unknown as Record<string, unknown> }))
vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => h.user,
  requireRole: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    const row = await table('content_items').get(id)
    if (!row) throw Object.assign(new Error('Item not found'), { status: 404 })
    return row
  },
}))
vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async () => 'sent'),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({ mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(), mirrorRawAssets: vi.fn(), newRawAssets: () => [] }))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn(), announceBatchChange: vi.fn() }))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { POST } = await import('../app/api/production/items/[id]/transition/route')
const move = async (to: string) => {
  const res = await POST(
    new Request(`https://x.test/api/production/items/${ITEM}/transition`, { method: 'POST', body: JSON.stringify({ to }) }),
    { params: Promise.resolve({ id: ITEM }) },
  )
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

let fake: ReturnType<typeof seedDb>
afterEach(() => fake?.restore())

const seed = (status: string, files: unknown[]) => seedDb({
  clients: [{ id: 'c1', name: 'Acme', timezone: 'Australia/Melbourne', default_scheduler_ids: [] }] as unknown as Row[],
  team_users: [{ ...JOY, active_status: true }] as unknown as Row[],
  team_user_clients: [{ id: 'j__c1', team_user_id: JOY.id, client_id: 'c1' }] as unknown as Row[],
  content_items: [{
    id: ITEM, client_id: 'c1', title: 'First shoot', status, content_type: 'reel', owner_id: 'u-ed',
    scheduler_ids: [], current_version_number: 1, batch_id: null, work_kind_id: null, client_approval_required: true,
    due_date: null, edit_round: 1, final_files: files,
  }] as unknown as Row[],
})
const card = async () => {
  const { table } = await import('@/lib/db')
  return await table('content_items').get(ITEM, { fresh: true }) as Record<string, unknown>
}

describe('performTransition writes client_frozen in the same claim as the move to With client', () => {
  it('freezes the files the move saw; a file added afterwards changes the card, never the frozen copy', async () => {
    fake = seed('quality_check', [f('a1', 1), f('b1', 1)])
    h.user = JOY
    const r = await move('client_review')
    expect(r.status).toBe(200)
    const after = await card()
    expect(after.status).toBe('client_review')
    const frozen = readClientFrozen(after.client_frozen)
    expect(frozen?.round).toBe(1)
    expect(frozen?.files.map(x => x.id)).toEqual(['a1', 'b1'])

    // somebody adds a third file to the same round after the send
    const { table } = await import('@/lib/db')
    await table('content_items').update(ITEM, { final_files: [f('a1', 1), f('b1', 1), f('late', 1)] } as never)
    const later = await card()
    expect(frozenFilesForClient(later as never)?.map(x => x.id)).toEqual(['a1', 'b1'])
  })

  it('no other move writes it', async () => {
    fake = seed('quality_check', [f('a1', 1)])
    h.user = JOY
    const r = await move('revision_required')
    expect(r.status).toBe(200)
    expect((await card()).client_frozen ?? null).toBeNull()
  })

  it('the freeze is built from the row the claim read, inside the claim', () => {
    const src = readFileSync('app/lib/workflow.ts', 'utf8')
    expect(src).toContain('client_frozen: clientFrozenFor(row as never, frozenAt)')
    expect(src).toMatch(/claim\(item\.id, cur =>\s*\(cur && cur\.status === from \? withFreeze\(\{ \.\.\.cur, \.\.\.movePatch \}/)
  })
})
