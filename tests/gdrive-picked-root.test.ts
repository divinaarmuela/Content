import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Client, Row } from '@/lib/db-types'

/**
 * The owner's HQ folder is not ours to change.
 *
 * Once a person hands the app the agency's real "MD Media HQ → Clients"
 * folder, the app is a guest in somebody else's filing cabinet: years of
 * folders, shared with clients, freelancers and a bookkeeper. It may ADD. It
 * may not share, re-share, un-share, rename, replace or duplicate.
 *
 * Every test here is one of those sentences, checked against the real
 * `gdrive.ts` with Google replaced by a fake that records every request — so a
 * permission call that should not happen fails the test rather than a person's
 * access.
 */

vi.mock('../app/lib/secret-box', () => ({
  credentialsKeyConfigured: () => true,
  decryptSecret: (v: string) => v.replace(/^enc:/, ''),
  encryptSecret: (v: string) => `enc:${v}`,
}))

vi.mock('../app/lib/inbox-connect', () => ({
  inboxClientId: () => 'client-id',
  inboxClientSecret: () => 'client-secret',
  googleAccessToken: async () => 'access-token',
  forgetGoogleToken: () => {},
}))

/** Every request the code made, in order. */
let calls: { method: string; url: string; body: unknown }[] = []
/** The fake Drive's folders: id → { name, parent }. */
let folders: Record<string, { name: string; parent: string }> = {}
let nextId = 1
/** Set to a status to make the NEXT metadata read fail with it. */
let readFails: number | null = null
/** Set to a status to make every folder LISTING fail with it. */
let listFails: number | null = null

const FILES = 'https://www.googleapis.com/drive/v3/files'

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : null
  calls.push({ method, url, body })

  if (!url.startsWith(FILES)) throw new Error(`unexpected request: ${method} ${url}`)

  // create
  if (method === 'POST' && !url.includes('/permissions')) {
    const id = `new-${nextId++}`
    folders[id] = { name: String(body.name), parent: String(body.parents?.[0] ?? '') }
    return ok({ id, name: body.name })
  }
  // permissions — nothing in these tests may ever reach here
  if (url.includes('/permissions')) return ok({ id: 'perm-1', permissions: [] })

  // list
  if (method === 'GET' && url.startsWith(`${FILES}?`)) {
    if (listFails) return new Response('busy', { status: listFails })
    const q = new URL(url).searchParams.get('q') ?? ''
    const parent = /^'([^']+)' in parents/.exec(q)?.[1] ?? ''
    const wanted = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'")
    const files = Object.entries(folders)
      .filter(([, f]) => f.parent === parent)
      .filter(([, f]) => wanted === undefined || f.name === wanted)
      .map(([id, f]) => ({ id, name: f.name }))
    return ok({ files })
  }
  // read one
  if (method === 'GET') {
    if (readFails) {
      const status = readFails
      readFails = null
      return new Response('nope', { status })
    }
    const id = decodeURIComponent(url.slice(FILES.length + 1).split('?')[0])
    const f = folders[id]
    if (!f) return new Response('not found', { status: 404 })
    return ok({ id, name: f.name, trashed: false })
  }
  throw new Error(`unexpected request: ${method} ${url}`)
})

const {
  DriveNotConfirmedError, clientFolderId, rootFolderId, shareWithDomain,
} = await import('../app/lib/gdrive')
const { syncDriveMembers } = await import('../app/lib/gdrive-members')

const connection = (extra: Record<string, unknown>) => ({
  id: 'team',
  account_email: 'tech@mdmmarketing.com.au',
  account_name: 'MD Media',
  refresh_token_encrypted: 'enc:refresh',
  root_name: 'Clients',
  connected_at: '2026-09-01T00:00:00.000Z',
  connected_by: 'owner@example.invalid',
  created_at: '2026-09-01T00:00:00.000Z',
  ...extra,
}) as unknown as Row

const client = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, name, slug: id, status: 'active', created_at: '2026-01-01T00:00:00.000Z', ...extra,
}) as unknown as Row

let fake: ReturnType<typeof seedDb>

const permissionCalls = () => calls.filter(c => c.url.includes('/permissions'))

beforeEach(() => {
  calls = []
  nextId = 1
  readFails = null
  listFails = null
  folders = {
    hq: { name: 'MD Media HQ', parent: 'root' },
    'clients-folder': { name: 'Clients', parent: 'hq' },
    'f-alia': { name: 'Alia Fragrance', parent: 'clients-folder' },
  }
})

afterEach(() => { fake?.restore() })

/**
 * These run with automatic filing ON.
 *
 * Automatic filing is off by default now (`gdrive-policy.ts`), which would
 * make every case here pass for the wrong reason — nothing is created because
 * nothing is attempted. The rules this file exists to prove are the ones INSIDE
 * `gdrive.ts`: adopt rather than duplicate, never share, never revoke. So the
 * switch is turned on for the duration and put back afterwards.
 */
const filingBefore = process.env.DRIVE_AUTO_FILING
beforeEach(() => { process.env.DRIVE_AUTO_FILING = '1' })
afterEach(() => {
  if (filingBefore === undefined) delete process.env.DRIVE_AUTO_FILING
  else process.env.DRIVE_AUTO_FILING = filingBefore
})

describe('a picked root that nobody has confirmed yet', () => {
  beforeEach(() => {
    fake = seedDb({
      drive_connection: [connection({
        root_origin: 'picked', root_folder_id: 'hq', root_folder_name: 'MD Media HQ',
        clients_folder_id: null,
      })],
      clients: [client('c1', 'Alia Fragrance Pty Ltd')],
    })
  })

  it('says so plainly instead of answering with the HQ folder', async () => {
    await expect(rootFolderId()).rejects.toBeInstanceOf(DriveNotConfirmedError)
    await expect(rootFolderId()).rejects.toThrow('Drive folder not confirmed yet')
  })

  it('creates nothing at the top of the owner’s HQ folder', async () => {
    await expect(clientFolderId('c1', 'Alia Fragrance Pty Ltd')).rejects.toThrow()
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
    expect(Object.keys(folders)).toEqual(['hq', 'clients-folder', 'f-alia'])
  })
})

describe('a confirmed picked root', () => {
  beforeEach(() => {
    fake = seedDb({
      drive_connection: [connection({
        root_origin: 'picked', root_folder_id: 'hq', root_folder_name: 'MD Media HQ',
        clients_folder_id: 'clients-folder',
      })],
      clients: [
        client('c1', 'Alia Fragrance Pty Ltd'),
        client('c2', 'Brand New Client'),
      ],
      team_users: [{
        id: 'u1', email: 'freelancer@gmail.com', name: 'Sam', role: 'editor',
        employment_type: 'contractor', active_status: true,
      }] as unknown as Row[],
    })
  })

  it('files everything under the Clients folder', async () => {
    expect(await rootFolderId()).toBe('clients-folder')
  })

  it('adopts the folder that is already there, by its tidied name', async () => {
    // Drive says "Alia Fragrance"; the client record says "Alia Fragrance Pty
    // Ltd". A raw-name comparison would call that a miss and make a second
    // folder beside the real one.
    expect(await clientFolderId('c1', 'Alia Fragrance Pty Ltd')).toBe('f-alia')
    expect(calls.filter(c => c.method === 'POST')).toEqual([])

    const row = fake.rows('clients').find(r => r.id === 'c1') as unknown as Client
    expect(row.drive_folder_id).toBe('f-alia')
    expect(row.drive_folder_origin).toBe('adopted')
  })

  it('never grants a permission on a folder it adopted', async () => {
    await clientFolderId('c1', 'Alia Fragrance Pty Ltd')
    expect(permissionCalls()).toEqual([])
  })

  it('makes NO folder for a client that has none — it says so and stops', async () => {
    // It used to create one. The owner's ruling ended that: the app makes no
    // folders in their Drive, not even a helpful one. A person makes it in
    // Drive — where they can see what is already in there under a name we
    // might not have recognised — and the next lookup adopts it.
    const id = await clientFolderId('c2', 'Brand New Client')
    expect(id).toBeNull()
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
    expect(permissionCalls()).toEqual([])

    const row = fake.rows('clients').find(r => r.id === 'c2') as unknown as Client
    expect(row.drive_folder_id).toBeFalsy()
  })

  it('adopts a folder somebody made in Drive, by its tidied name', async () => {
    // the half that still works: the folder exists, so it is used as it is
    folders['made-by-hand'] = { name: 'Brand New Client', parent: 'clients-folder' }
    calls = []
    expect(await clientFolderId('c2', 'Brand New Client Pty Ltd')).toBe('made-by-hand')
    expect(calls.filter(c => c.method === 'POST')).toEqual([])

    const row = fake.rows('clients').find(r => r.id === 'c2') as unknown as Client
    expect(row.drive_folder_origin).toBe('adopted')
  })

  it('shares nothing, ever', async () => {
    await shareWithDomain('f-alia')
    expect(permissionCalls()).toEqual([])
  })

  it('does not sync members, and above all revokes nobody', async () => {
    const res = await syncDriveMembers()
    expect(res.ok).toBe(true)
    expect(res.reason).toBe('owner_manages_sharing')
    expect(res.added).toEqual([])
    expect(res.removed).toEqual([])
    // not one request of any kind — the guard is before the read
    expect(calls).toEqual([])
  })

  it('will not create a client folder when Drive cannot be listed', async () => {
    // a 429 on the listing is not "there is nothing in there" — creating on
    // the strength of it is exactly how a duplicate folder appears
    listFails = 429
    expect(await clientFolderId('c2', 'Brand New Client')).toBe(null)
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
    listFails = null
  })
})

describe('the app’s own root, unchanged', () => {
  beforeEach(() => {
    folders = { 'app-root': { name: 'Clients', parent: 'root' } }
    fake = seedDb({
      drive_connection: [connection({ root_folder_id: 'app-root' })],
      clients: [client('c1', 'Alia Fragrance Pty Ltd')],
    })
  })

  it('still resolves its own folder', async () => {
    expect(await rootFolderId()).toBe('app-root')
  })

  it('never re-makes it, whatever Drive is doing', async () => {
    // It used to read the folder back and make a replacement on a 404. The
    // dashboard makes no folders at all now, so the recorded id is returned
    // as it is and Drive is not asked about it — a 429 cannot fork the tree
    // because nothing here can create a second one.
    readFails = 429
    expect(await rootFolderId()).toBe('app-root')
    const row = fake.rows('drive_connection')[0] as unknown as { root_folder_id: string }
    expect(row.root_folder_id).toBe('app-root')
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
  })
})
