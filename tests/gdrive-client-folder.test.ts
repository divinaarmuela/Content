import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Client, Row } from '@/lib/db-types'

/**
 * The client's own folder is READ before anything is created.
 *
 * This is the whole point of matching folders in Settings: once a client
 * carries a folder id, the shoot hooks and the mirror file into that folder —
 * whatever it is called, wherever it sits — instead of making a fresh one
 * named after the client record. Drive is not connected in this test at all,
 * so if the recorded id were not consulted first the answer would be null.
 */

const { clientFolderId } = await import('../app/lib/gdrive')

let fake: ReturnType<typeof seedDb>

beforeEach(() => {
  fake = seedDb({
    clients: [
      {
        id: 'c1', name: 'Alia Fragrance Pty Ltd', slug: 'alia', status: 'active',
        created_at: '2026-01-01T00:00:00.000Z', drive_folder_id: 'folder-made-in-2021',
      },
      {
        id: 'c2', name: 'No Folder Yet', slug: 'none', status: 'active',
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ] as unknown as Row[],
  })
})

afterEach(() => { fake.restore() })

describe('clientFolderId', () => {
  it('returns the folder recorded on the client, without asking Drive', async () => {
    expect(await clientFolderId('c1', 'Alia Fragrance Pty Ltd')).toBe('folder-made-in-2021')
  })

  it('is a no-op when there is nothing recorded and Drive is not connected', async () => {
    expect(await clientFolderId('c2', 'No Folder Yet')).toBe(null)
    const row = fake.rows('clients').find(r => r.id === 'c2') as unknown as Client
    expect(row.drive_folder_id).toBeFalsy()
  })
})
