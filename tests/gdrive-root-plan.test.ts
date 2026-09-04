import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Client, Row } from '@/lib/db-types'

/**
 * Adopting the folders that were already in Drive.
 *
 * The rule this file exists to hold: **nothing is created before Apply.**
 * Reading somebody's Drive is free; making folders in it is not, and a
 * half-applied plan leaves a mess that has to be cleaned up by hand. So the
 * fake Drive below counts every create, and the plan tests assert the count is
 * still zero.
 */

// a stand-in for Google Drive: folders in memory, and a tally of every write
const drive = {
  root: { id: 'hq', name: 'MD Media HQ', owner: 'tech@mdmmarketing.com.au' } as
    { id: string; name: string; owner: string | null } | null,
  clientsFolderId: null as string | null,
  subfolders: [] as { id: string; name: string }[],
  created: [] as { parent: string; name: string }[],
  nextId: 1,
}

vi.mock('../app/lib/gdrive', () => ({
  driveConfigured: () => true,
  pickedRoot: async () => drive.root && {
    id: drive.root.id,
    name: drive.root.name,
    owner_email: drive.root.owner,
    picked_at: '2026-09-04T00:00:00.000Z',
    picked_by: 'owner@example.invalid',
    clients_folder_id: drive.clientsFolderId,
  },
  readFolder: async (id: string) => ({ ok: true, name: `folder ${id}`, ownerEmail: null }),
  savePickedRoot: async () => {},
  saveClientsFolder: async (id: string) => { drive.clientsFolderId = id },
  findSubfolder: async (_parent: string, name: string) => ({
    ok: true,
    id: name === 'Clients' ? drive.clientsFolderId : null,
  }),
  listSubfolders: async () => ({ ok: true, folders: [...drive.subfolders] }),
  createSubfolder: async (parent: string, name: string) => {
    const id = `made-${drive.nextId++}`
    drive.created.push({ parent, name })
    if (parent === 'hq' && name === 'Clients') drive.clientsFolderId = id
    else drive.subfolders.push({ id, name })
    return { ok: true, id }
  },
  shareWithDomain: async (id: string) => `https://drive.google.com/drive/folders/${id}`,
}))

const { applyRootPlan, buildRootPlan } = await import('../app/lib/gdrive-root')

const client = (id: string, name: string, extra: Partial<Client> = {}) => ({
  id, name, slug: id, status: 'active', created_at: '2026-01-01T00:00:00.000Z',
  ...extra,
}) as unknown as Row

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  drive.root = { id: 'hq', name: 'MD Media HQ', owner: 'tech@mdmmarketing.com.au' }
  drive.clientsFolderId = 'clients-folder'
  drive.subfolders = [
    { id: 'f1', name: 'Cecconis Toorak and Flinders' },
    { id: 'f2', name: 'Alia Fragrance' },
    { id: 'f3', name: 'Some Old Project' },
  ]
  drive.created = []
  drive.nextId = 1
  fake = seedDb({
    clients: [
      client('c1', "Cecconi's Toorak & Flinders"),
      client('c2', 'Alia Fragrance Pty Ltd'),
      client('c3', '100 Hundred Million Group'),
      client('c4', 'Gone Away', { status: 'archived' }),
    ],
  })
})

afterEach(() => { fake.restore() })

const rowFor = (plan: { rows: { client_id: string }[] }, id: string) =>
  plan.rows.find(r => r.client_id === id)!

describe('the plan', () => {
  it('matches the folders that are already there and says what is missing', async () => {
    const res = await buildRootPlan()
    if (!res.ok) throw new Error(res.message)
    const { plan } = res

    expect(plan.total).toBe(3) // the archived client is left out
    expect(plan.matched).toBe(2)
    expect(plan.to_create).toBe(1)
    expect(rowFor(plan, 'c1')).toMatchObject({ folder_id: 'f1', confidence: 'exact', action: 'link' })
    expect(rowFor(plan, 'c2')).toMatchObject({ folder_id: 'f2', confidence: 'exact', action: 'link' })
    expect(rowFor(plan, 'c3')).toMatchObject({ folder_id: null, action: 'create' })
    expect(plan.extra.map(f => f.id)).toEqual(['f3'])
  })

  it('creates nothing', async () => {
    await buildRootPlan()
    expect(drive.created).toEqual([])
    expect(fake.rows('clients').every(r => !(r as unknown as Client).drive_folder_id)).toBe(true)
  })

  it('offers every folder as an override', async () => {
    const res = await buildRootPlan()
    if (!res.ok) throw new Error(res.message)
    expect(res.plan.folders.map(f => f.id)).toEqual(['f1', 'f2', 'f3'])
  })

  it('leaves a client that is already pointed at a folder alone', async () => {
    await fake.restore()
    fake = seedDb({
      clients: [client('c1', "Cecconi's Toorak & Flinders", { drive_folder_id: 'f3' })],
    })
    const res = await buildRootPlan()
    if (!res.ok) throw new Error(res.message)
    expect(rowFor(res.plan, 'c1')).toMatchObject({
      folder_id: 'f3', confidence: 'recorded', action: 'linked',
    })
    // the folder it holds is not offered to anybody else
    expect(res.plan.extra.map(f => f.id)).toEqual(['f1', 'f2'])
  })
})

describe('the Clients folder', () => {
  beforeEach(() => { drive.clientsFolderId = null })

  it('asks rather than making one', async () => {
    const res = await buildRootPlan()
    if (!res.ok) throw new Error(res.message)
    expect(res.plan.needs_clients_folder).toBe(true)
    expect(drive.created).toEqual([])
    // every client would need a folder, and the screen says so
    expect(res.plan.to_create).toBe(3)
  })

  it('makes it once, and only when asked', async () => {
    const res = await buildRootPlan({ createClientsFolder: true })
    if (!res.ok) throw new Error(res.message)
    expect(drive.created).toEqual([{ parent: 'hq', name: 'Clients' }])
    expect(res.plan.needs_clients_folder).toBe(false)
  })
})

describe('applying it', () => {
  it('records the matched folders and makes only the confirmed ones', async () => {
    const res = await applyRootPlan([
      { client_id: 'c1', folder_id: 'f1' },
      { client_id: 'c2', folder_id: 'f2' },
      { client_id: 'c3', create: true },
    ])
    if (!res.ok) throw new Error(res.message)

    expect(res.result).toMatchObject({ linked: 2, created: 1, skipped: [] })
    expect(drive.created).toEqual([
      { parent: 'clients-folder', name: '100 Hundred Million Group' },
    ])

    const clients = Object.fromEntries(
      fake.rows('clients').map(r => [r.id, (r as unknown as Client).drive_folder_id]),
    )
    expect(clients.c1).toBe('f1')
    expect(clients.c2).toBe('f2')
    expect(clients.c3).toBe('made-1')
    expect(clients.c4).toBeFalsy()
  })

  it('honours an override over what the matcher guessed', async () => {
    const res = await applyRootPlan([{ client_id: 'c1', folder_id: 'f3' }])
    if (!res.ok) throw new Error(res.message)
    const row = fake.rows('clients').find(r => r.id === 'c1') as unknown as Client
    expect(row.drive_folder_id).toBe('f3')
    expect(drive.created).toEqual([])
  })

  it('skips a row with nothing chosen instead of guessing', async () => {
    const res = await applyRootPlan([{ client_id: 'c3' }])
    if (!res.ok) throw new Error(res.message)
    expect(res.result.skipped).toEqual([{ client_id: 'c3', why: 'no folder chosen' }])
    expect(drive.created).toEqual([])
  })

  it('says so when the client is gone rather than failing the lot', async () => {
    const res = await applyRootPlan([
      { client_id: 'nope', folder_id: 'f1' },
      { client_id: 'c2', folder_id: 'f2' },
    ])
    if (!res.ok) throw new Error(res.message)
    expect(res.result.linked).toBe(1)
    expect(res.result.skipped).toHaveLength(1)
  })

  it('refuses when no folder has been chosen at all', async () => {
    drive.root = null
    const res = await applyRootPlan([{ client_id: 'c1', folder_id: 'f1' }])
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.message).toBe('Choose the folder first')
  })
})
