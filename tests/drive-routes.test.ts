import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * The Files page's routes, against a Drive that is not there.
 *
 * The stub below is the whole of Google as far as these tests are concerned:
 * it records every call and answers whatever the test set up. That makes the
 * two things worth pinning testable at all —
 *
 *  1. **Who may.** Every route is team-only, and a client portal login is
 *     refused by the server, not by a hidden button.
 *  2. **Nothing changes without a person.** The owner's instruction is that
 *     the app never renames or moves anything in their Drive on its own, so
 *     `confirm: true` is a gate the server enforces: without it, Drive is not
 *     called AT ALL. That is asserted by counting calls on the stub, not by
 *     reading the status code — a 400 with the file already moved would pass
 *     a weaker test.
 *
 * There is no delete route to test, on purpose: nothing this page can do
 * removes a file from the owner's Drive.
 */

/* ── who is asking ──────────────────────────────────────────────────────── */

const ROLES = ['scheduler', 'editor', 'account_manager', 'super_admin'] as const
type Role = (typeof ROLES)[number] | 'client'

let me: { email: string; role: Role } = { email: 'jess@md.invalid', role: 'account_manager' }

class FakeAuthzError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

function satisfies(actual: Role, required: Role): boolean {
  if (actual === 'super_admin') return true
  if (actual === 'client' || required === 'client') return actual === required
  return ROLES.indexOf(actual as never) >= ROLES.indexOf(required as never)
}

vi.mock('../app/lib/authz', () => ({
  AuthzError: FakeAuthzError,
  requireRole: async (required: Role) => {
    if (!satisfies(me.role, required)) throw new FakeAuthzError('Insufficient permissions', 403)
    return { ...me, id: 'u1', active_status: true }
  },
  authzErrorResponse: (e: unknown) => (
    e instanceof FakeAuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'Internal error', status: 500 }
  ),
}))

/* ── Google, as far as these tests are concerned ────────────────────────── */

const drive = {
  calls: [] as { op: string; args: unknown[] }[],
  entries: [] as Record<string, unknown>[],
  failNext: null as string | null,
  chunkDone: false,
}
const note = (op: string, ...args: unknown[]) => { drive.calls.push({ op, args }) }
const count = (op: string) => drive.calls.filter(c => c.op === op).length
const fail = (message: string) => ({ ok: false, reason: 'api_error', message })

vi.mock('../app/lib/gdrive', () => ({
  driveConfigured: () => true,
  pickedRoot: async () => ({
    id: 'HQ1', name: 'MD Media HQ', owner_email: 'tech@md.invalid',
    picked_at: '2026-09-01T00:00:00.000Z', picked_by: 'owner@md.invalid',
    clients_folder_id: 'CL1',
  }),
  rootFolderId: async () => 'CL1',
}))

vi.mock('../app/lib/gdrive-files', () => ({
  driveFileUrl: (id: string) => `https://drive.google.com/file/d/${id}/view`,
  listEntries: async (opts: unknown) => {
    note('list', opts)
    return { ok: true, entries: drive.entries, nextPageToken: null }
  },
  entryDetail: async (id: string) => {
    note('detail', id)
    return {
      ok: true,
      entry: {
        id, name: 'Spring reel v2.mp4', mimeType: 'video/mp4', size: 118,
        modified: '2026-09-04T00:00:00.000Z', ownerName: 'Jess',
        ownerEmail: 'jess@md.invalid', hasThumbnail: true, webViewLink: null,
        parents: ['CL1'],
      },
    }
  },
  trailTo: async (id: string, rootId: string) => {
    note('trail', id, rootId)
    return { ok: true, trail: [{ id: rootId, name: 'MD Media HQ' }, { id, name: 'Clients' }] }
  },
  isInside: async (candidate: string, ancestor: string) => {
    note('isInside', candidate, ancestor)
    return candidate === 'deep' && ancestor === 'top'
  },
  findOrCreateFolder: async (parent: string, name: string) => {
    note('findOrCreateFolder', parent, name)
    return drive.failNext === 'folder' ? fail('Google Drive 500') : { ok: true, id: 'NEW1', created: true }
  },
  renameDriveItem: async (id: string, name: string) => {
    note('rename', id, name)
    return drive.failNext === 'rename' ? fail('Google Drive 403') : { ok: true, name }
  },
  moveDriveFile: async (id: string, to: string) => {
    note('move', id, to)
    return drive.failNext === 'move' ? fail('Google Drive 403') : { ok: true, moved: true }
  },
  shareableLink: async (id: string) => {
    note('share', id)
    return { ok: true, url: `https://drive.google.com/file/d/${id}/view` }
  },
  openUploadSession: async (parent: string, name: string, size: number | null) => {
    note('uploadStart', parent, name, size)
    return drive.failNext === 'start'
      ? fail('Google Drive 500 starting the upload')
      : { ok: true, uri: 'https://upload.example.invalid/session-1', name }
  },
  pushUploadChunk: async (uri: string, chunk: Uint8Array, start: number) => {
    note('chunk', uri, chunk.length, start)
    if (drive.failNext === 'chunk') return fail('Google Drive 503 during the upload')
    return drive.chunkDone
      ? { ok: true, done: true, id: 'FILE1', bytes: start + chunk.length }
      : { ok: true, done: false, received: start + chunk.length }
  },
  openThumbnail: async () => fail('no preview'),
  openDownload: async () => fail('no file'),
}))

vi.mock('../app/lib/stream', () => ({ previewFor: async () => null }))

const listRoute = await import('../app/api/drive/list/route')
const rootRoute = await import('../app/api/drive/root/route')
const trailRoute = await import('../app/api/drive/trail/route')
const infoRoute = await import('../app/api/drive/info/route')
const folderRoute = await import('../app/api/drive/folder/route')
const renameRoute = await import('../app/api/drive/rename/route')
const moveRoute = await import('../app/api/drive/move/route')
const shareRoute = await import('../app/api/drive/share/route')
const startRoute = await import('../app/api/drive/upload/start/route')
const chunkRoute = await import('../app/api/drive/upload/chunk/route')

const get = (path: string) => new Request(`https://app.test.invalid${path}`)
const post = (path: string, body: unknown) => new Request(`https://app.test.invalid${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const client = (id: string, folder: string): Row =>
  ({ id, name: 'Pure Allure', slug: id, status: 'active', drive_folder_id: folder }) as unknown as Row

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  me = { email: 'jess@md.invalid', role: 'account_manager' }
  drive.calls = []
  drive.entries = []
  drive.failNext = null
  drive.chunkDone = false
  fake = seedDb({ clients: [client('c1', 'PA1')], drive_files: [], drive_uploads: [] })
})
afterEach(() => fake.restore())

/* ── the role gate ──────────────────────────────────────────────────────── */

describe('team only, clients never', () => {
  const everyRoute: [string, () => Promise<Response>][] = [
    ['root', () => rootRoute.GET()],
    ['list', () => listRoute.GET(get('/api/drive/list?parent=HQ1'))],
    ['trail', () => trailRoute.GET(get('/api/drive/trail?id=CL1'))],
    ['info', () => infoRoute.GET(get('/api/drive/info?id=FILE1'))],
    ['folder', () => folderRoute.POST(post('/api/drive/folder', { parent: 'HQ1', name: 'New' }))],
    ['rename', () => renameRoute.POST(post('/api/drive/rename', { id: 'F1', name: 'x', confirm: true }))],
    ['move', () => moveRoute.POST(post('/api/drive/move', { ids: ['F1'], to: 'CL1', confirm: true }))],
    ['share', () => shareRoute.POST(post('/api/drive/share', { id: 'F1', confirm: true }))],
    ['upload start', () => startRoute.POST(post('/api/drive/upload/start', { parent: 'HQ1', name: 'a.mp4', size: 10 }))],
  ]

  it('refuses a client on every single route', async () => {
    me = { email: 'someone@client.invalid', role: 'client' }
    for (const [name, call] of everyRoute) {
      const res = await call()
      expect(res.status, name).toBe(403)
    }
    // and nothing reached Google on the way to being refused
    expect(drive.calls).toEqual([])
  })

  it('lets every team role in — Files is the shared filing cabinet', async () => {
    for (const role of ROLES) {
      me = { email: `${role}@md.invalid`, role }
      const res = await listRoute.GET(get('/api/drive/list?parent=HQ1'))
      expect(res.status, role).toBe(200)
    }
  })
})

/* ── reading ────────────────────────────────────────────────────────────── */

describe('reading Drive', () => {
  it('says where the cabinet is, and admits what it cannot see', async () => {
    const body = await (await rootRoute.GET()).json()
    expect(body.root.id).toBe('HQ1')
    expect(body.partial).toBe(true)
    expect(body.note).toMatch(/Google Drive/)
  })

  it('refuses a parent that is not a Drive id, before Google is called', async () => {
    const res = await listRoute.GET(get(`/api/drive/list?parent=${encodeURIComponent("x' or '1")}`))
    expect(res.status).toBe(400)
    expect(count('list')).toBe(0)
  })

  it('lists the root when no folder and no search is given', async () => {
    await listRoute.GET(get('/api/drive/list'))
    expect((drive.calls[0].args[0] as { parentId: string }).parentId).toBe('HQ1')
  })

  it('searches everywhere when there is text and no folder', async () => {
    await listRoute.GET(get('/api/drive/list?q=reel'))
    const opts = drive.calls[0].args[0] as { parentId: string | null; text: string }
    expect(opts.parentId).toBeNull()
    expect(opts.text).toBe('reel')
  })

  it('builds a breadcrumb from the picked root', async () => {
    const body = await (await trailRoute.GET(get('/api/drive/trail?id=CL1'))).json()
    expect(body.trail.map((c: { id: string }) => c.id)).toEqual(['HQ1', 'CL1'])
  })

  it('joins drive_files onto a file the app put there', async () => {
    fake.restore()
    fake = seedDb({
      clients: [client('c1', 'PA1')],
      drive_files: [{
        id: 'df1', item_id: null, client_id: 'c1', source_url: 'drive://FILE1',
        target: 'files', drive_file_id: 'FILE1', uploaded_by: 'jess@md.invalid',
      } as unknown as Row],
    })
    const body = await (await infoRoute.GET(get('/api/drive/info?id=FILE1'))).json()
    expect(body.mirror.client_name).toBe('Pure Allure')
    expect(body.mirror.uploaded_by).toBe('jess@md.invalid')
  })

  it('says nothing about a file the app never touched, rather than guessing', async () => {
    const body = await (await infoRoute.GET(get('/api/drive/info?id=FILE9'))).json()
    expect(body.mirror).toBeNull()
  })
})

/* ── the confirmation gate ──────────────────────────────────────────────── */

describe('nothing is renamed, moved or shared without a person saying so', () => {
  it('refuses a rename with no confirm — and never calls Google', async () => {
    for (const body of [
      { id: 'F1', name: 'New name' },
      { id: 'F1', name: 'New name', confirm: false },
      { id: 'F1', name: 'New name', confirm: 'true' },
    ]) {
      const res = await renameRoute.POST(post('/api/drive/rename', body))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/needs to be confirmed/)
    }
    expect(count('rename')).toBe(0)
  })

  it('refuses a move with no confirm — and never calls Google', async () => {
    const res = await moveRoute.POST(post('/api/drive/move', { ids: ['F1'], to: 'CL1' }))
    expect(res.status).toBe(400)
    expect(count('move')).toBe(0)
  })

  it('refuses a share with no confirm — and never calls Google', async () => {
    const res = await shareRoute.POST(post('/api/drive/share', { id: 'F1' }))
    expect(res.status).toBe(400)
    expect(count('share')).toBe(0)
  })

  it('renames exactly one thing when confirmed, and records the old name', async () => {
    const res = await renameRoute.POST(post('/api/drive/rename', {
      id: 'F1', name: 'Spring reel v3.mp4', confirm: true,
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ was: 'Spring reel v2.mp4', name: 'Spring reel v3.mp4' })
    expect(count('rename')).toBe(1)
  })

  it('has no bulk rename to reach for', () => {
    // a list of ids is simply not part of the request shape
    expect(Object.keys(renameRoute)).toEqual(['dynamic', 'POST'])
  })
})

/* ── moving ─────────────────────────────────────────────────────────────── */

describe('moving, once it has been confirmed', () => {
  it('refuses a folder into itself', async () => {
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['CL1'], to: 'CL1', confirm: true,
    }))
    expect(res.status).toBe(400)
    expect(count('move')).toBe(0)
  })

  it('refuses a folder into one of its own folders', async () => {
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['top'], to: 'deep', confirm: true,
    }))
    expect((await res.json()).error).toMatch(/its own folders/)
    expect(count('move')).toBe(0)
  })

  it('moves what it can and names what it could not', async () => {
    drive.failNext = 'move'
    const body = await (await moveRoute.POST(post('/api/drive/move', {
      ids: ['F1'], to: 'CL1', confirm: true,
    }))).json()
    expect(body.moved).toEqual([])
    expect(body.failed[0]).toMatchObject({ id: 'F1', name: 'Spring reel v2.mp4' })
  })

  it('writes the new folder onto the drive_files row so the mirror agrees', async () => {
    fake.restore()
    fake = seedDb({
      clients: [client('c1', 'PA1')],
      drive_files: [{
        id: 'df1', source_url: 'https://r2.invalid/a.mp4', target: 'item',
        drive_file_id: 'F1', parent_id: 'OLD1',
      } as unknown as Row],
    })
    await moveRoute.POST(post('/api/drive/move', { ids: ['F1'], to: 'CL1', confirm: true }))
    const row = fake.rows('drive_files')[0] as unknown as { parent_id: string; moved_at: string }
    expect(row.parent_id).toBe('CL1')
    expect(row.moved_at).toBeTruthy()
  })
})

/* ── new folders ────────────────────────────────────────────────────────── */

describe('a new folder', () => {
  it('refuses a nameless one', async () => {
    const res = await folderRoute.POST(post('/api/drive/folder', { parent: 'HQ1', name: '  ' }))
    expect(res.status).toBe(400)
    expect(count('findOrCreateFolder')).toBe(0)
  })

  it('goes through find-or-create, never a bare create', async () => {
    const res = await folderRoute.POST(post('/api/drive/folder', { parent: 'HQ1', name: 'Sept' }))
    expect(res.status).toBe(200)
    expect(count('findOrCreateFolder')).toBe(1)
  })
})

/* ── uploading ──────────────────────────────────────────────────────────── */

describe('an upload a person started', () => {
  const start = () => startRoute.POST(post('/api/drive/upload/start', {
    parent: 'PA1', name: 'clip.mp4', size: 10, mime_type: 'video/mp4',
  }))

  it('keeps the Google session on the server and hands out an id of ours', async () => {
    const body = await (await start()).json()
    expect(body.upload).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('upload.example.invalid')
    const row = fake.rows('drive_uploads')[0] as unknown as
      { upload_uri: string; client_id: string; status: string }
    expect(row.upload_uri).toBe('https://upload.example.invalid/session-1')
    // the folder is this client's, so the upload is filed under them
    expect(row.client_id).toBe('c1')
    expect(row.status).toBe('open')
  })

  it('refuses a file bigger than Drive takes, before opening anything', async () => {
    const res = await startRoute.POST(post('/api/drive/upload/start', {
      parent: 'PA1', name: 'huge.mov', size: 6 * 1024 ** 4,
    }))
    expect(res.status).toBe(400)
    expect(count('uploadStart')).toBe(0)
  })

  it('records the file in drive_files only once Drive has it', async () => {
    const upload = (await (await start()).json()).upload as string

    // one slice that is not the last: nothing is written yet
    let res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(5) },
    ))
    expect((await res.json()).done).toBe(false)
    expect(fake.rows('drive_files')).toHaveLength(0)

    drive.chunkDone = true
    res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=5`,
      { method: 'POST', body: new Uint8Array(5) },
    ))
    expect((await res.json()).done).toBe(true)

    const row = fake.rows('drive_files')[0] as unknown as
      { drive_file_id: string; parent_id: string; client_id: string; target: string; uploaded_by: string }
    expect(row).toMatchObject({
      drive_file_id: 'FILE1', parent_id: 'PA1', client_id: 'c1',
      target: 'files', uploaded_by: 'jess@md.invalid',
    })
  })

  it('leaves the folder exactly as it was when an upload fails', async () => {
    const upload = (await (await start()).json()).upload as string
    drive.failNext = 'chunk'
    const res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(5) },
    ))
    expect(res.status).toBe(502)
    // no row claiming a file that is not there…
    expect(fake.rows('drive_files')).toHaveLength(0)
    // …the session is closed rather than left open for a retry to find…
    expect((fake.rows('drive_uploads')[0] as unknown as { status: string }).status).toBe('failed')
    // …and nothing was renamed or re-attempted under another name
    expect(count('rename')).toBe(0)
    expect(count('uploadStart')).toBe(1)
  })

  it('will not take a slice for an upload that has finished', async () => {
    const upload = (await (await start()).json()).upload as string
    drive.chunkDone = true
    await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(1) },
    ))
    const res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=1`,
      { method: 'POST', body: new Uint8Array(1) },
    ))
    expect(res.status).toBe(404)
  })

  it('will not take somebody else’s upload', async () => {
    const upload = (await (await start()).json()).upload as string
    me = { email: 'sam@md.invalid', role: 'editor' }
    const res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(1) },
    ))
    expect(res.status).toBe(404)
  })
})

/* ── what does not exist ────────────────────────────────────────────────── */

describe('there is no way to delete anything', () => {
  it('has no delete route under /api/drive', async () => {
    const { readdirSync } = await import('node:fs')
    const names = readdirSync('app/api/drive')
    expect(names).not.toContain('delete')
    expect(names).not.toContain('trash')
  })

  // the helper module itself is checked in tests/drive-folder-adopt.test.ts,
  // where it is the real thing rather than the stub above
})
