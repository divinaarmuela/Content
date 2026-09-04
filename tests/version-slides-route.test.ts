import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The versions endpoint, on the one question carousels made new: what
 * counts as a saveable version now that a version may be many files.
 *
 * The version store and the Drive mirror are stubbed — they are exercised
 * elsewhere — so what is under test here is exactly the validation an editor
 * runs into, in the words they see. The database is not stubbed: the route
 * runs the real `@/lib/db` against an in-memory Realtime Database, which is
 * what the final-post approval reset at the end of the route touches.
 */

const item: Record<string, unknown> = {
  id: 'item-1', client_id: 'client-1', status: 'draft_uploaded',
  owner_id: 'user-1', scheduler_ids: [], content_type: 'carousel',
}

const addVersion = vi.fn(async (_actor: unknown, _id: string, links: Record<string, unknown>) => ({
  id: 'v-1', version_number: 3, ...links,
}))
const mirrorVersionSlides = vi.fn()
const performTransition = vi.fn(async (
  _actor: unknown, it: { status: string }, to: string, _opts?: { auto?: boolean },
) => ({ ...it, status: to }))
const logActivity = vi.fn()

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => ({ id: 'user-1', role: 'editor', email: 'e@x.invalid' }),
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error', status: 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({ loadItemForUser: async () => item }))
vi.mock('../app/lib/workflow', () => ({ addVersion, performTransition, logActivity }))
const announceItemChange = vi.fn()
vi.mock('../app/lib/production-live', () => ({ announceItemChange }))
vi.mock('../app/lib/gdrive-mirror', () => ({ mirrorVersionSlides }))
// same reason as the Drive mirror above: the real module builds its client at
// import time (CLAUDE.md trap 7), so importing it here would fail the suite on
// a missing env var rather than on anything about this route
const previewVideos = vi.fn()
vi.mock('../app/lib/stream', () => ({ previewVideos }))

const { POST } = await import('../app/api/production/items/[id]/versions/route')

const params = Promise.resolve({ id: 'item-1' })
const post = async (body: unknown) => {
  const res = await POST(
    new Request('https://x.test/api', { method: 'POST', body: JSON.stringify(body) }),
    { params },
  )
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

const u = (n: string) => `https://media.mdmmarketing.com.au/${n}`

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  addVersion.mockClear()
  mirrorVersionSlides.mockClear()
  performTransition.mockClear()
  announceItemChange.mockClear()
  logActivity.mockClear()
  for (const k of Object.keys(item)) delete item[k]
  Object.assign(item, {
    id: 'item-1', client_id: 'client-1', status: 'draft_uploaded',
    owner_id: 'user-1', scheduler_ids: [], content_type: 'carousel',
  })
  fake = seedDb({
    content_items: [{
      id: 'item-1', client_id: 'client-1', title: 'A carousel',
      content_type: 'carousel', status: 'draft_uploaded', owner_id: 'user-1',
    }] as unknown as Row[],
  })
})
afterEach(() => fake.restore())

describe('POST /api/production/items/:id/versions — slides', () => {
  it('saves the slides in the order they were sent', async () => {
    const { status } = await post({
      files: [{ url: u('a.jpg') }, { url: u('b.jpg') }, { url: u('c.mp4') }],
    })
    expect(status).toBe(201)
    const links = addVersion.mock.calls[0][2] as { files: { url: string }[]; file_url: string }
    expect(links.files.map(f => f.url)).toEqual([u('a.jpg'), u('b.jpg'), u('c.mp4')])
    // slide one is also file_url, so every pre-carousel reader still sees it
    expect(links.file_url).toBe(u('a.jpg'))
  })

  it('mirrors every slide to Drive, not just the first', async () => {
    await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(mirrorVersionSlides).toHaveBeenCalledTimes(1)
    expect(mirrorVersionSlides.mock.calls[0][2]).toHaveLength(2)
  })

  it('refuses a carousel of one, in the words the editor sees', async () => {
    const { status, json } = await post({ files: [{ url: u('a.jpg') }] })
    expect(status).toBe(422)
    expect(json.error).toBe('A carousel needs at least 2 slides')
    expect(addVersion).not.toHaveBeenCalled()
  })

  it('still accepts the old single file_url shape', async () => {
    item.content_type = 'static'
    const { status } = await post({ file_url: u('one.jpg'), notes: 'first cut' })
    expect(status).toBe(201)
    const links = addVersion.mock.calls[0][2] as { files: unknown[]; file_url: string }
    expect(links.file_url).toBe(u('one.jpg'))
    expect(links.files).toHaveLength(1)
  })

  it('still accepts a version that is only a review link', async () => {
    item.content_type = 'carousel'
    const { status } = await post({ drive_url: 'https://drive.google.com/file/d/abc' })
    expect(status).toBe(201)
    expect((addVersion.mock.calls[0][2] as { files: unknown[] }).files).toHaveLength(0)
  })

  it('refuses a version with nothing in it to look at', async () => {
    const { status, json } = await post({ notes: 'trust me' })
    expect(status).toBe(422)
    expect(String(json.error)).toMatch(/uploaded file or a review link/)
  })

  it('drops slides no publisher could fetch rather than losing the good ones', async () => {
    const { status } = await post({
      files: [{ url: 'blob:https://app.test/9f2a' }, { url: u('a.jpg') }, { url: u('b.jpg') }],
    })
    expect(status).toBe(201)
    expect((addVersion.mock.calls[0][2] as { files: unknown[] }).files).toHaveLength(2)
  })

  it('caps a carousel at ten slides', async () => {
    await post({ files: Array.from({ length: 14 }, (_, i) => ({ url: u(`s${i}.jpg`) })) })
    expect((addVersion.mock.calls[0][2] as { files: unknown[] }).files).toHaveLength(10)
  })
})

describe('POST /api/production/items/:id/versions — saving one while the client is looking', () => {
  it('sends the piece back for the manager’s check', async () => {
    item.status = 'client_review'
    const { status } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    // the version is saved FIRST — the move is a consequence of it, and an
    // upload must never be lost to a status change that failed
    expect(addVersion).toHaveBeenCalledTimes(1)
    expect(performTransition).toHaveBeenCalledTimes(1)
    expect(performTransition.mock.calls[0][2]).toBe('internal_review')
    // `{ auto: true }` is not decoration: without it the move is refused —
    // this edge is the app's own and nobody may press it — and the route
    // swallows that refusal and still returns 201, so the piece would stay in
    // front of the client showing a version nobody checked
    expect(performTransition.mock.calls[0][3]).toEqual({ auto: true })
    // the live hint carries where the item actually IS now, not where it was
    expect(announceItemChange.mock.calls[0][0]).toMatchObject({ status: 'internal_review' })
  })

  it('sends a piece the client ALREADY APPROVED back to them', async () => {
    // the newer half of the rule. The schedule's media rail and the
    // composer's Approved tab read the latest version of an approved item, so
    // a version saved here without this move would appear on the calendar
    // wearing a "Client approved" badge and go out unseen.
    item.status = 'approved_for_scheduling'
    const { status } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    expect(addVersion).toHaveBeenCalledTimes(1)
    expect(performTransition).toHaveBeenCalledTimes(1)
    expect(performTransition.mock.calls[0][2]).toBe('client_review')
    expect(performTransition.mock.calls[0][3]).toEqual({ auto: true })
    expect(announceItemChange.mock.calls[0][0]).toMatchObject({ status: 'client_review' })
  })

  it('leaves a booked piece where it is — there is no edge back from there', async () => {
    // stated rather than silently true: an item at `scheduled` is the one
    // status the new-version rule does not cover, because coming back would
    // mean cancelling the provider's job as well
    item.status = 'scheduled'
    await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(performTransition).not.toHaveBeenCalled()
  })

  it('leaves a piece the client already sent back alone', async () => {
    // a new version at client_changes_requested is exactly what was asked for
    item.status = 'client_changes_requested'
    await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(performTransition).not.toHaveBeenCalled()
    expect(announceItemChange.mock.calls[0][0]).toMatchObject({ status: 'client_changes_requested' })
  })

  it('moves nothing on an ordinary draft', async () => {
    await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(performTransition).not.toHaveBeenCalled()
  })

  it('keeps the version even when the move loses a race', async () => {
    item.status = 'client_review'
    performTransition.mockRejectedValueOnce(new Error('someone else moved it'))
    const { status, json } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    expect(json.version_number).toBe(3)
  })
})

describe('POST /api/production/items/:id/versions — new pictures after the post was signed off', () => {
  it('puts the final-post approval back to pending', async () => {
    item.posting_approval_state = 'approved'
    fake.restore()
    fake = seedDb({
      content_items: [{
        id: 'item-1', client_id: 'client-1', title: 'A carousel',
        content_type: 'carousel', status: 'draft_uploaded', owner_id: 'user-1',
        posting_approval_state: 'approved', posting_approved_by: 'user-9',
      }] as unknown as Row[],
    })
    const { status } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    const saved = fake.rows('content_items')[0] as Record<string, unknown>
    expect(saved.posting_approval_state).toBe('pending')
    expect(saved.posting_approved_by).toBeUndefined()
    // the History says why the badge changed
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'posting_approval_reset' }),
    )
  })

  it('leaves an approval alone when somebody withdrew it mid-upload', async () => {
    item.posting_approval_state = 'approved'
    fake.restore()
    fake = seedDb({
      content_items: [{
        id: 'item-1', client_id: 'client-1', title: 'A carousel',
        content_type: 'carousel', status: 'draft_uploaded', owner_id: 'user-1',
        posting_approval_state: 'draft',
      }] as unknown as Row[],
    })
    const { status } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    expect((fake.rows('content_items')[0] as Record<string, unknown>).posting_approval_state).toBe('draft')
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('does nothing at all on an item that never had the gate', async () => {
    const { status } = await post({ files: [{ url: u('a.jpg') }, { url: u('b.jpg') }] })
    expect(status).toBe(201)
    expect((fake.rows('content_items')[0] as Record<string, unknown>).posting_approval_state).toBeUndefined()
    expect(logActivity).not.toHaveBeenCalled()
  })
})
