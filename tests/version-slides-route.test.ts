import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The versions endpoint, on the one question carousels made new: what
 * counts as a saveable version now that a version may be many files.
 *
 * The database and the Drive mirror are stubbed — they are exercised
 * elsewhere — so what is under test here is exactly the validation an editor
 * runs into, in the words they see.
 */

const item = {
  id: 'item-1', client_id: 'client-1', status: 'draft_uploaded',
  owner_id: 'user-1', scheduler_ids: [], content_type: 'carousel',
}

const addVersion = vi.fn(async (_actor: unknown, _id: string, links: Record<string, unknown>) => ({
  id: 'v-1', version_number: 3, ...links,
}))
const mirrorVersionSlides = vi.fn()

vi.mock('../app/lib/authz', () => ({
  requireSignedIn: async () => ({ id: 'user-1', role: 'editor', email: 'e@x.invalid' }),
  authzErrorResponse: (e: unknown) => ({
    error: e instanceof Error ? e.message : 'error', status: 500,
  }),
}))
vi.mock('../app/lib/production-access', () => ({ loadItemForUser: async () => item }))
vi.mock('../app/lib/workflow', () => ({ addVersion }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))
vi.mock('../app/lib/gdrive-mirror', () => ({ mirrorVersionSlides }))

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

beforeEach(() => {
  addVersion.mockClear()
  mirrorVersionSlides.mockClear()
  item.content_type = 'carousel'
})

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
