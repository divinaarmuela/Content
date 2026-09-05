import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * GOOGLE DRIVE, FOR A POST THAT HAS NO PIECE YET — AND STILL READ ONLY.
 *
 * "New post" now opens on the sources, so the Drive tab has to be answerable
 * before any piece exists: the folder is the CLIENT's own, read from
 * `clients.drive_folder_id` exactly as it is recorded.
 *
 * The rule that cannot rot is CLAUDE.md trap 13: the dashboard only READS
 * Google Drive. Bringing a file across is a download and a copy into our own
 * storage — the file in the owner's HQ folder is not moved, renamed, re-shared
 * or deleted, and no folder is created by looking at the tab. Both halves are
 * checked: what the code does at run time, and what the source is allowed to
 * contain.
 */

const h = vi.hoisted(() => ({
  user: { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null } as Record<string, unknown>,
  /** every request this test's Drive layer was asked to make */
  calls: [] as { url: string; method: string }[],
}))

vi.mock('../app/lib/authz', () => {
  class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  }
  return {
    AuthzError,
    authzErrorResponse: (e: unknown) => (e instanceof AuthzError
      ? { error: e.message, status: e.status }
      : { error: e instanceof Error ? e.message : 'error', status: 500 }),
    requireRole: async () => h.user,
    requireSignedIn: async () => h.user,
  }
})

vi.mock('../app/lib/gdrive', () => ({
  FILES: 'https://www.googleapis.com/drive/v3/files',
  ALL_DRIVES: { supportsAllDrives: 'true' },
  ALL_DRIVES_LIST: { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' },
  driveConfigured: () => true,
  accessToken: async () => ({ ok: true, token: 'tok' }),
  /** every read the module makes, recorded — and a read is all it may make */
  driveFetch: vi.fn(async (_token: string, url: string) => {
    h.calls.push({ url, method: 'GET' })
    if (url.includes('mimeType%20%3D%20%27application%2Fvnd.google-apps.folder')
      || url.includes('application/vnd.google-apps.folder')) {
      return { ok: true, data: { files: [] } }
    }
    if (url.includes('/files/drive-file-1')) {
      return { ok: true, data: { id: 'drive-file-1', name: 'hero shot.jpg', mimeType: 'image/jpeg', size: '400000' } }
    }
    return {
      ok: true,
      data: { files: [{ id: 'drive-file-1', name: 'hero shot.jpg', mimeType: 'image/jpeg', size: '400000' }] },
    }
  }),
}))

const BASE = 'https://media.mdmmarketing.com.au'
vi.mock('../app/lib/storage', () => ({
  publicBase: () => BASE,
  r2Configured: () => true,
  putObject: vi.fn(async (name: string) => ({
    publicUrl: `${BASE}/1712345678901-ab12cd-${name.replace(/[^A-Za-z0-9._-]/g, '_')}`,
    key: 'k',
  })),
  headStoredObject: vi.fn(async () => ({ contentType: 'image/jpeg', bytes: 400_000 })),
  deleteStoredObject: vi.fn(async () => {}),
  MAX_DERIVED_BYTES: 64 * 1024 * 1024,
}))
vi.mock('../lib/live', () => ({ announce: vi.fn(), announceAfter: vi.fn() }))

const drive = await import('../app/api/social/schedule/drive/route')

const CLIENT = 'c1'
let fake: ReturnType<typeof seedDb>
let realFetch: typeof globalThis.fetch

const json = async (res: Response | Promise<Response>) => {
  const r = await res
  return { status: r.status, body: await r.json() as any }
}

beforeEach(() => {
  h.calls.length = 0
  fake = seedDb({
    clients: [{
      id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne',
      drive_folder_id: 'folder-acme',
    }] as unknown as Row[],
    team_users: [{
      ...h.user, active_status: true, employment_type: 'employee',
      timezone: 'Australia/Melbourne', client_id: null,
    }] as unknown as Row[],
    team_user_clients: [
      { id: `u-am__${CLIENT}`, team_user_id: 'u-am', client_id: CLIENT },
    ] as unknown as Row[],
    content_items: [],
  })
  // the DOWNLOAD is a plain fetch; record it and hand back bytes
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? '')
    if (url.includes('googleapis.com')) {
      h.calls.push({ url, method: String(init?.method ?? 'GET').toUpperCase() })
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
    }
    return realFetch(input, init)
  }) as typeof globalThis.fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  fake.restore()
  vi.clearAllMocks()
})

describe('the client’s own Drive folder, with no piece in the way', () => {
  it('lists the media in it', async () => {
    const res = await json(drive.GET(
      new Request(`https://x.test/api/social/schedule/drive?clientId=${CLIENT}`)))
    expect(res.status).toBe(200)
    expect(res.body.files[0]).toMatchObject({ id: 'drive-file-1', type: 'image' })
  })

  it('says so plainly when the client has no folder yet', async () => {
    fake.restore()
    fake = seedDb({
      clients: [{ id: CLIENT, name: 'Acme', timezone: 'Australia/Melbourne' }] as unknown as Row[],
      team_users: [{
        ...h.user, active_status: true, employment_type: 'employee',
        timezone: 'Australia/Melbourne', client_id: null,
      }] as unknown as Row[],
      team_user_clients: [
        { id: `u-am__${CLIENT}`, team_user_id: 'u-am', client_id: CLIENT },
      ] as unknown as Row[],
      content_items: [],
    })
    const res = await json(drive.GET(
      new Request(`https://x.test/api/social/schedule/drive?clientId=${CLIENT}`)))
    expect(String(res.body.error)).toContain('Upload the file instead')
  })

  it('copies a file into OUR storage and never writes to Drive', async () => {
    const res = await json(drive.POST(new Request('https://x.test/api/social/schedule/drive', {
      method: 'POST',
      body: JSON.stringify({ client_id: CLIENT, file_ids: ['drive-file-1'] }),
    })))
    expect(res.status).toBe(200)
    // the slide points at our own storage, and remembers where it came from
    expect(String(res.body.files[0].url).startsWith(BASE)).toBe(true)
    expect(res.body.files[0].source).toBe('drive')
    expect(res.body.files[0].drive_file_id).toBe('drive-file-1')

    // EVERY request to Google was a read
    expect(h.calls.length).toBeGreaterThan(0)
    for (const call of h.calls) expect(call.method).toBe('GET')
  })

  it('refuses a client this person is not on', async () => {
    const res = await json(drive.GET(
      new Request('https://x.test/api/social/schedule/drive?clientId=c-not-mine')))
    expect(res.status).toBe(403)
  })
})

describe('the source itself cannot grow a Drive writer', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/lib/schedule-drive.ts'), 'utf8')

  it('makes no folders, moves nothing, deletes nothing', () => {
    for (const forbidden of [
      'application/vnd.google-apps.folder\', ', 'addParents', 'removeParents',
      'permissions', 'trashed: true', 'method: \'DELETE\'', 'method: \'PATCH\'',
      'method: \'POST\'', 'uploadType',
    ]) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })

  it('reads the client folder as recorded, and never creates one', () => {
    expect(source).toContain('drive_folder_id')
    expect(source).not.toContain('ensureClient')
    expect(source).not.toContain('rootFolderId')
  })
})
