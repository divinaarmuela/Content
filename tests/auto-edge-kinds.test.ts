import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * AN `auto` EDGE HAS TO WORK FOR ALL THREE KINDS OF ITEM.
 *
 * A piece of content, an internal task and a shoot brief all ride the same
 * state machine, but each is checked through its own wrapper —
 * `checkTransitionAs`, `checkTaskTransitionAs`, `checkBriefTaskTransitionAs`.
 * When `auto` was introduced it was threaded through the first one only, so
 * the pre-existing "a new version while the client is looking pulls the piece
 * back" move silently stopped working for the other two: the versions route
 * catches the refusal, logs it and still returns 201, so the item stayed in
 * front of the client showing a draft nobody had checked.
 *
 * This drives the REAL `performTransition` — not a mock of it — because the
 * wrappers are exactly what a mock would skip, and testing
 * `checkTransitionAs` on its own is what let the regression through.
 */

const h = vi.hoisted(() => ({
  user: { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null },
  emails: [] as Record<string, unknown>[],
}))

vi.mock('../app/lib/mailer', () => ({
  notify: vi.fn(async (m: Record<string, unknown>) => { h.emails.push(m) }),
  renderEmail: (_s: string, body: string) => body,
  escapeHtml: (s: string) => s,
}))
vi.mock('../app/lib/gdrive-mirror', () => ({
  mirrorLatestVersionSoon: vi.fn(), mirrorVersionSlides: vi.fn(),
  mirrorRawAssets: vi.fn(), newRawAssets: () => [],
}))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
vi.mock('../app/lib/production-live', () => ({
  announceItemChange: vi.fn(), announceBatchChange: vi.fn(),
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async () => ({})) } }))

const { performTransition } = await import('../app/lib/workflow')

const CLIENT = 'c1'
const OWNER = { id: 'u-ed', role: 'editor' as const, email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const AM = { id: 'u-am', role: 'account_manager' as const, email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }

/** One item of each kind, all sitting where the client can see them. */
const ASSET = 'aaaaaaaa-0000-4000-8000-000000000001'
const TASK = 'bbbbbbbb-0000-4000-8000-000000000002'
const BRIEF = 'cccccccc-0000-4000-8000-000000000003'
/** …and one already approved, for the newer of the two auto edges */
const APPROVED_TASK = 'dddddddd-0000-4000-8000-000000000004'

let fake: ReturnType<typeof seedDb>

const baseItem = (id: string, kindId: string | null, status: string) => ({
  id, client_id: CLIENT, title: `Item ${id.slice(0, 4)}`, status,
  owner_id: OWNER.id, scheduler_ids: [], content_type: 'static',
  work_kind_id: kindId, batch_id: null, current_version_number: 1,
  posting_approval_state: null, due_date: null,
})

beforeEach(() => {
  h.emails = []
  fake = seedDb({
    clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
    work_kinds: [
      // a shoot brief is not "internal" — it has its own vocabulary
      { id: 'k-brief', slug: 'shoot_brief', name: 'Shoot plan', uses_media: true, active: true },
      // an internal task carries no media at all, which is what makes it one
      { id: 'k-task', slug: 'research', name: 'Research', uses_media: false, active: true },
    ] as unknown as Row[],
    content_items: [
      baseItem(ASSET, null, 'client_review'),
      baseItem(TASK, 'k-task', 'client_review'),
      baseItem(BRIEF, 'k-brief', 'client_review'),
      baseItem(APPROVED_TASK, 'k-task', 'approved_for_scheduling'),
    ] as unknown as Row[],
    asset_versions: [],
    batches: [],
    team_users: [OWNER, AM].map(u => ({
      ...u, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    })) as unknown as Row[],
    team_user_clients: [{ id: `${AM.id}__${CLIENT}`, team_user_id: AM.id, client_id: CLIENT }] as unknown as Row[],
    workflow_activity: [],
    notification_log: [],
    schedule_entries: [],
  })
})
afterEach(() => {
  fake.restore()
  vi.clearAllMocks()
})

const rowOf = (id: string) =>
  (fake.rows('content_items') as unknown as { id: string; status: string }[]).find(i => i.id === id)!

const move = (id: string, to: string, opts?: Record<string, unknown>) =>
  performTransition(OWNER as never, rowOf(id) as never, to as never, opts as never)

describe('the app’s own move works for every kind of item', () => {
  it('pulls a piece of CONTENT back off the client’s desk', async () => {
    await move(ASSET, 'internal_review', { auto: true })
    expect(rowOf(ASSET).status).toBe('internal_review')
  })

  it('pulls an INTERNAL TASK back — the case that silently stopped working', async () => {
    await move(TASK, 'internal_review', { auto: true })
    expect(rowOf(TASK).status).toBe('internal_review')
  })

  it('pulls a SHOOT BRIEF back too', async () => {
    await move(BRIEF, 'internal_review', { auto: true })
    expect(rowOf(BRIEF).status).toBe('internal_review')
  })

  it('takes the newer edge for a task the client already approved', async () => {
    await move(APPROVED_TASK, 'client_review', { auto: true })
    expect(rowOf(APPROVED_TASK).status).toBe('client_review')
  })
})

describe('…and none of them is something a person can press', () => {
  it('refuses the edge on every kind when the app does not claim the move', async () => {
    for (const id of [ASSET, TASK, BRIEF]) {
      await expect(move(id, 'internal_review')).rejects.toThrow(/something the app does/)
      expect(rowOf(id).status).toBe('client_review')
    }
  })

  it('refuses the newer edge the same way', async () => {
    await expect(move(APPROVED_TASK, 'client_review')).rejects.toThrow(/something the app does/)
    expect(rowOf(APPROVED_TASK).status).toBe('approved_for_scheduling')
  })

  it('still checks the hats — claiming the move is not a way past them', async () => {
    // a scheduler wears no hat that may pull a piece back off the client
    const scheduler = { ...OWNER, id: 'u-sch', role: 'scheduler' as const }
    await expect(
      performTransition(scheduler as never, rowOf(ASSET) as never, 'internal_review' as never, { auto: true } as never),
    ).rejects.toThrow()
    expect(rowOf(ASSET).status).toBe('client_review')
  })
})
