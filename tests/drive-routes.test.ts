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
 *
 * ── And the write routes are switched off ──
 *
 * The dashboard makes no writes to Google Drive at all. The write half still
 * exists — new folder, move, rename, share, upload — still confirm-gated,
 * still contained inside HQ, and still tested here, because a reviewed
 * switched-off feature is worth more than one that has to be reinvented in a
 * hurry. `DRIVE_PAGE_WRITES=1` is what puts it back, and the cases below that
 * exercise it set that variable deliberately, one describe block at a time.
 * The first block asserts the default: every one of them answers 403 and
 * Google is not called.
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
  /** has a person chosen the HQ folder in Settings yet? */
  picked: true,
  /** does the connection row exist at all? */
  connected: true,
  /** what `isInside` should answer — 'unknown' is the read-error case */
  ancestry: 'outside' as 'inside' | 'outside' | 'unknown',
  /** what `isInside(x, HQ1)` answers — the containment check */
  containment: 'inside' as 'inside' | 'outside' | 'unknown',
  /** the URI the upload session hands back */
  uploadUri: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=1',
}
const note = (op: string, ...args: unknown[]) => { drive.calls.push({ op, args }) }
const count = (op: string) => drive.calls.filter(c => c.op === op).length
const fail = (message: string) => ({ ok: false, reason: 'api_error', message })

vi.mock('../app/lib/gdrive', () => ({
  driveConfigured: () => true,
  driveStatus: async () => ({ connected: drive.connected }),
  pickedRoot: async () => (drive.picked ? {
    id: 'HQ1', name: 'MD Media HQ', owner_email: 'tech@md.invalid',
    picked_at: '2026-09-01T00:00:00.000Z', picked_by: 'owner@md.invalid',
    clients_folder_id: 'CL1',
  } : null),
  // Deliberately present and deliberately loud. `filesRoot()` used to fall
  // through to this, and this is the call that CREATES a folder in the tech
  // account's Drive and stamps `root_folder_id`. If a read path ever reaches
  // it again, a test fails rather than a folder appearing in somebody's Drive.
  rootFolderId: async () => {
    note('rootFolderId')
    throw new Error('a read path must never call rootFolderId')
  },
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
    // containment: everything in these tests lives under HQ1 unless a case
    // says otherwise by naming the folder 'OUTSIDE'
    if (ancestor === 'HQ1') return candidate === 'OUTSIDE' ? 'outside' : drive.containment
    if (drive.ancestry !== 'outside') return drive.ancestry
    return candidate === 'deep' && ancestor === 'top' ? 'inside' : 'outside'
  },
  searchBelow: async (opts: unknown) => {
    note('searchBelow', opts)
    return { ok: true, entries: drive.entries, foldersSearched: 7, capped: false }
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
      : { ok: true, uri: drive.uploadUri, name }
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

/** Turn the write half on for one describe block, and off again after. */
function withWrites() {
  beforeEach(() => { process.env.DRIVE_PAGE_WRITES = '1' })
  afterEach(() => { delete process.env.DRIVE_PAGE_WRITES })
}

beforeEach(() => {
  me = { email: 'jess@md.invalid', role: 'account_manager' }
  drive.calls = []
  drive.entries = []
  drive.failNext = null
  drive.chunkDone = false
  drive.picked = true
  drive.connected = true
  drive.ancestry = 'outside'
  drive.containment = 'inside'
  drive.uploadUri = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=1'
  fake = seedDb({ clients: [client('c1', 'PA1')], drive_files: [], drive_uploads: [] })
})
afterEach(() => fake.restore())

/* ── the default: the dashboard does not write to Drive ─────────────────── */

describe('every write route is off', () => {
  const WRITES: [string, () => Promise<Response>][] = [
    ['folder', () => folderRoute.POST(post('/api/drive/folder', { parent: 'HQ1', name: 'New' }))],
    ['rename', () => renameRoute.POST(post('/api/drive/rename', { id: 'F1', name: 'x', confirm: true }))],
    ['move', () => moveRoute.POST(post('/api/drive/move', { ids: ['F1'], to: 'CL1', confirm: true }))],
    ['share', () => shareRoute.POST(post('/api/drive/share', { id: 'F1', confirm: true }))],
    ['upload start', () => startRoute.POST(post('/api/drive/upload/start', { parent: 'CL1', name: 'a.mp4', size: 10 }))],
    ['upload chunk', () => chunkRoute.POST(new Request(
      'https://app.test.invalid/api/drive/upload/chunk?upload=x&offset=0',
      { method: 'POST', body: new Uint8Array(1) },
    ))],
  ]

  it('answers 403 and never touches Google', async () => {
    for (const [name, call] of WRITES) {
      const res = await call()
      expect(res.status, name).toBe(403)
      expect((await res.json()).error, name).toBe('Drive is read-only from the dashboard')
    }
    expect(drive.calls).toEqual([])
  })

  it('refuses BEFORE the role check — the cheapest possible no', async () => {
    // a super admin gets the same answer as everybody else: this is not a
    // permission, it is a decision about what the app does
    me = { email: 'owner@md.invalid', role: 'super_admin' }
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['F1'], to: 'CL1', confirm: true,
    }))
    expect(res.status).toBe(403)
    expect(drive.calls).toEqual([])
  })

  it('leaves every READ route working', async () => {
    expect((await rootRoute.GET()).status).toBe(200)
    expect((await listRoute.GET(get('/api/drive/list?parent=CL1'))).status).toBe(200)
    expect((await trailRoute.GET(get('/api/drive/trail?id=CL1'))).status).toBe(200)
    expect((await infoRoute.GET(get('/api/drive/info?id=FILE1'))).status).toBe(200)
  })
})

/* ── the role gate ──────────────────────────────────────────────────────── */

describe('team only, clients never', () => {
  withWrites()
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
    expect(body.picked).toBe(true)
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

  it('searches BELOW the folder, not just its direct children', async () => {
    // Drive's `q` has no subtree operator, so a search has to walk. The page
    // says "in here or below it"; this is the call that makes that true.
    const body = await (await listRoute.GET(get('/api/drive/list?parent=CL1&q=reel'))).json()
    expect(count('searchBelow')).toBe(1)
    expect(count('list')).toBe(0)
    const opts = drive.calls[0].args[0] as { parentId: string; text: string }
    expect(opts.parentId).toBe('CL1')
    expect(opts.text).toBe('reel')
    expect(body.searched).toBe(7)
  })

  it('does not walk for a plain listing', async () => {
    await listRoute.GET(get('/api/drive/list?parent=CL1'))
    expect(count('list')).toBe(1)
    expect(count('searchBelow')).toBe(0)
  })

  it('hands the listing its own drive_files join, so the browser need not', async () => {
    fake.restore()
    fake = seedDb({
      clients: [client('c1', 'PA1')],
      drive_files: [{
        id: 'df1', item_id: null, client_id: 'c1', source_url: 'drive://FILE1',
        target: 'files', drive_file_id: 'FILE1',
      } as unknown as Row],
    })
    drive.entries = [{
      id: 'FILE1', name: 'a.mp4', mimeType: 'video/mp4', size: 1, modified: null,
      ownerName: null, ownerEmail: null, hasThumbnail: false, webViewLink: null,
    }]
    const body = await (await listRoute.GET(get('/api/drive/list?parent=CL1'))).json()
    expect(body.clients).toEqual({ FILE1: 'c1' })
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
  withWrites()
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
  withWrites()
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

  it('refuses when it could not CHECK — a read error is not a "no"', async () => {
    // the dangerous shape: a transient Drive 500 during the ancestry walk used
    // to read as "safe to move", and a folder into its own child is the one
    // thing on this page nobody can undo
    drive.ancestry = 'unknown'
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['top'], to: 'deep', confirm: true,
    }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Could not check that folder just now — try again.')
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
  withWrites()
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
  withWrites()
  const start = () => startRoute.POST(post('/api/drive/upload/start', {
    parent: 'PA1', name: 'clip.mp4', size: 10, mime_type: 'video/mp4',
  }))

  it('keeps the Google session on the server and hands out an id of ours', async () => {
    const body = await (await start()).json()
    expect(body.upload).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('upload_id')
    const row = fake.rows('drive_uploads')[0] as unknown as
      { upload_uri: string; client_id: string; status: string }
    expect(row.upload_uri).toBe(drive.uploadUri)
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

  it('will not take an upload when it cannot tell who anybody is', async () => {
    // `row.created_by && by && row.created_by !== by` used to wave through a
    // team member with no email on their Clerk record — and any row whose
    // created_by was null. "We could not tell who you are" is not a yes.
    const upload = (await (await start()).json()).upload as string
    me = { email: '', role: 'editor' }
    const res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(1) },
    ))
    expect(res.status).toBe(404)
    expect(count('chunk')).toBe(0)
  })

  it('refuses a session whose stored URI is not Google', async () => {
    // the row lives in a database with open rules by the owner's decision, and
    // the next thing this route does is put a bearer token in a header
    drive.uploadUri = 'https://evil.example.invalid/collect'
    const upload = (await (await start()).json()).upload as string
    const res = await chunkRoute.POST(new Request(
      `https://app.test.invalid/api/drive/upload/chunk?upload=${upload}&offset=0`,
      { method: 'POST', body: new Uint8Array(1) },
    ))
    expect(res.status).toBe(404)
    expect(count('chunk')).toBe(0)
  })

  it('refuses an upload id that could walk out of its own table', async () => {
    const res = await chunkRoute.POST(new Request(
      'https://app.test.invalid/api/drive/upload/chunk?upload=..%2F..%2Fclients&offset=0',
      { method: 'POST', body: new Uint8Array(1) },
    ))
    expect(res.status).toBe(404)
    expect(count('chunk')).toBe(0)
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

/* ── containment: a write can only land inside HQ ───────────────────────── */

describe('with the write half switched on, everything lands inside HQ', () => {
  withWrites()

  // The dialogs' folder picker was rooted at HQ, so this was never reachable
  // by misclick — but the picker is presentation and the route is the gate.
  // Any team member down to scheduler can post a folder id of their own, and
  // `drive.file` reaches further than HQ: everything the app ever created,
  // anywhere, plus anything else a person handed it.

  it('refuses a move to a folder outside the picked root', async () => {
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['F1'], to: 'OUTSIDE', confirm: true,
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/outside MD Media HQ/)
    expect(count('move')).toBe(0)
  })

  it('refuses a move when it could not check containment', async () => {
    drive.containment = 'unknown'
    const res = await moveRoute.POST(post('/api/drive/move', {
      ids: ['F1'], to: 'CL1', confirm: true,
    }))
    expect(res.status).toBe(503)
    expect(count('move')).toBe(0)
  })

  it('refuses an upload into a folder outside HQ', async () => {
    const res = await startRoute.POST(post('/api/drive/upload/start', {
      parent: 'OUTSIDE', name: 'a.mp4', size: 10,
    }))
    expect(res.status).toBe(400)
    expect(count('uploadStart')).toBe(0)
    expect(fake.rows('drive_uploads')).toEqual([])
  })

  it('refuses a new folder outside HQ', async () => {
    const res = await folderRoute.POST(post('/api/drive/folder', {
      parent: 'OUTSIDE', name: 'Somewhere else',
    }))
    expect(res.status).toBe(400)
    expect(count('findOrCreateFolder')).toBe(0)
  })

  it('allows the root itself without a lookup', async () => {
    const res = await folderRoute.POST(post('/api/drive/folder', {
      parent: 'HQ1', name: 'Right here',
    }))
    expect(res.status).toBe(200)
    expect(count('findOrCreateFolder')).toBe(1)
  })

  it('refuses everything when nobody has picked HQ', async () => {
    drive.picked = false
    for (const [name, res] of [
      ['move', await moveRoute.POST(post('/api/drive/move', { ids: ['F1'], to: 'CL1', confirm: true }))],
      ['folder', await folderRoute.POST(post('/api/drive/folder', { parent: 'CL1', name: 'x' }))],
      ['upload', await startRoute.POST(post('/api/drive/upload/start', { parent: 'CL1', name: 'a', size: 1 }))],
    ] as [string, Response][]) {
      expect(res.status, name).toBe(409)
    }
    expect(count('move') + count('findOrCreateFolder') + count('uploadStart')).toBe(0)
  })
})

/* ── a GET must not change anything ─────────────────────────────────────── */

describe('a read path never creates a folder or settles the root', () => {
  // C-1: `filesRoot()` used to fall through to `rootFolderId()`, which creates
  // a folder at the top of the tech account's Drive and stamps
  // `root_folder_id`. A scheduler opening the page out of curiosity, before
  // the owner had picked HQ, would have made a stray folder and answered a
  // question nobody had asked — from a plain GET. The stub throws if that call
  // is reached at all, so this is a hard floor rather than an assertion about
  // one route.

  it('says "nobody has picked HQ yet" instead of picking one', async () => {
    drive.picked = false
    const res = await rootRoute.GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.root).toBeNull()
    expect(body.picked).toBe(false)
    expect(body.block).toBe('not_picked')
    expect(body.message).toMatch(/choose it in Settings/i)
    expect(drive.calls).toEqual([])
    expect(fake.rows('drive_connection')).toEqual([])
  })

  it('refuses to list, rather than making somewhere to list', async () => {
    drive.picked = false
    const res = await listRoute.GET(get('/api/drive/list'))
    expect(res.status).toBe(409)
    expect(count('list')).toBe(0)
    expect(count('rootFolderId')).toBe(0)
  })

  it('refuses a breadcrumb the same way', async () => {
    drive.picked = false
    const res = await trailRoute.GET(get('/api/drive/trail?id=CL1'))
    expect(res.status).toBe(409)
    expect(count('trail')).toBe(0)
  })

  it('tells apart "not connected" from "could not reach Google"', async () => {
    drive.connected = false
    const body = await (await rootRoute.GET()).json()
    expect(body.block).toBe('not_connected')
    // …and the other one is a different sentence, because somebody whose token
    // expired must not be sent to a Settings page that already says Connected
    const { FILES_BLOCK_WORDS, blockFor } = await import('../app/lib/drive-page')
    expect(blockFor('exchange_failed')).toBe('unreachable')
    expect(blockFor('no_refresh_token')).toBe('unreachable')
    expect(blockFor('not_connected')).toBe('not_connected')
    expect(FILES_BLOCK_WORDS.unreachable).toMatch(/Could not reach Google Drive/)
    expect(FILES_BLOCK_WORDS.unreachable).not.toMatch(/connect/i)
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
