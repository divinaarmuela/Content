import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two walks: "is this folder inside that one" and "what is below here".
 *
 * Both are the real helpers with only `gdrive.ts` stubbed, because both are
 * about what happens when Drive does NOT answer — and a stub of the helper
 * itself would be a stub of exactly the thing under test.
 *
 * The ancestry check is the one guard on this page whose failure cannot be
 * undone: Drive accepts a folder moved into its own child, and the branch then
 * disappears from the tree with nothing to bring it back. It used to answer
 * `false` on a read error, and the route read `false` as "safe".
 */

type Node = { id: string; name: string; parents: string[]; folder?: boolean }

const drive = {
  nodes: new Map<string, Node>(),
  /** ids whose read should fail, as a transient Drive 500 would */
  broken: new Set<string>(),
  listCalls: 0,
  listFails: new Set<string>(),
}

const FOLDER = 'application/vnd.google-apps.folder'

vi.mock('../app/lib/gdrive', () => ({
  ALL_DRIVES: { supportsAllDrives: 'true' },
  ALL_DRIVES_LIST: { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' },
  FILES: 'https://files.invalid',
  UPLOAD_FILES: 'https://upload.invalid',
  accessToken: async () => ({ ok: true, token: 't' }),
  findSubfolder: async () => ({ ok: true, id: null }),
  createSubfolder: async () => ({ ok: true, id: 'made' }),
  driveFetch: async (_token: string, url: string) => {
    // a listing: `…?q=…&fields=…` with the parent inside the q
    const parsed = new URL(url, 'https://files.invalid')
    const q = parsed.searchParams.get('q')
    if (q) {
      drive.listCalls += 1
      const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? ''
      if (drive.listFails.has(parent)) {
        return { ok: false, reason: 'api_error', message: 'Google Drive 500' }
      }
      const files = [...drive.nodes.values()]
        .filter(n => n.parents.includes(parent) && n.folder)
        .map(n => ({ id: n.id, name: n.name, mimeType: FOLDER }))
      return { ok: true, data: { files } }
    }
    // a single file read: `https://files.invalid/<id>?fields=…`
    const id = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    if (drive.broken.has(id)) {
      return { ok: false, reason: 'api_error', message: 'Google Drive 500' }
    }
    const node = drive.nodes.get(id)
    if (!node) return { ok: false, reason: 'api_error', message: 'Google Drive 404' }
    return {
      ok: true,
      data: {
        id: node.id, name: node.name, mimeType: node.folder ? FOLDER : 'video/mp4',
        parents: node.parents,
      },
    }
  },
}))

const { foldersUnder, isInside } = await import('../app/lib/gdrive-files')

const node = (id: string, parents: string[], folder = true): Node =>
  ({ id, name: id, parents, folder })

beforeEach(() => {
  //  HQ ─ CL ─ PA ─ SHOOT
  //     └ ARCHIVE
  drive.nodes = new Map([
    ['HQ', node('HQ', [])],
    ['CL', node('CL', ['HQ'])],
    ['PA', node('PA', ['CL'])],
    ['SHOOT', node('SHOOT', ['PA'])],
    ['ARCHIVE', node('ARCHIVE', ['HQ'])],
  ].map(([, n]) => [(n as Node).id, n as Node]) as [string, Node][])
  drive.broken = new Set()
  drive.listFails = new Set()
  drive.listCalls = 0
})

describe('is this folder inside that one', () => {
  it('says inside when it is, at any depth', async () => {
    expect(await isInside('SHOOT', 'CL')).toBe('inside')
    expect(await isInside('CL', 'CL')).toBe('inside')
  })

  it('says outside when the walk reaches the top without finding it', async () => {
    expect(await isInside('ARCHIVE', 'CL')).toBe('outside')
    expect(await isInside('HQ', 'CL')).toBe('outside')
  })

  it('says UNKNOWN when Drive would not answer — never "outside"', async () => {
    drive.broken.add('PA')
    // the honest answer about SHOOT's ancestry is now unavailable, and the
    // route refuses on it rather than permitting the one irreversible move
    expect(await isInside('SHOOT', 'CL')).toBe('unknown')
  })

  it('says UNKNOWN when the folder is not one the app can see', async () => {
    expect(await isInside('SOMEONE_ELSES', 'CL')).toBe('unknown')
  })

  it('says UNKNOWN rather than running out of depth quietly', async () => {
    // a chain longer than the walk allows: the answer is not "no"
    let previous = 'HQ'
    for (let i = 0; i < 40; i++) {
      const id = `deep${i}`
      drive.nodes.set(id, node(id, [previous]))
      previous = id
    }
    expect(await isInside(previous, 'CL')).toBe('unknown')
  })
})

describe('what is below a folder', () => {
  it('walks the whole subtree, breadth first, and includes the folder itself', async () => {
    const under = await foldersUnder('HQ')
    expect(under.ok && under.ids.sort()).toEqual(['ARCHIVE', 'CL', 'HQ', 'PA', 'SHOOT'])
    expect(under.ok && under.capped).toBe(false)
  })

  it('reports being capped rather than showing a short answer as a whole one', async () => {
    // 300 folders under one parent, past SEARCH_FOLDER_CAP
    for (let i = 0; i < 300; i++) drive.nodes.set(`f${i}`, node(`f${i}`, ['HQ']))
    const under = await foldersUnder('HQ')
    expect(under.ok && under.capped).toBe(true)
    expect(under.ok && under.ids.length).toBeLessThanOrEqual(200)
  })

  it('keeps going past a branch it cannot read, and says the answer may be short', async () => {
    drive.listFails.add('PA')
    const under = await foldersUnder('HQ')
    expect(under.ok && under.ids).toContain('ARCHIVE')
    expect(under.ok && under.capped).toBe(true)
  })

  it('refuses a parent that is not a Drive id, before Google is called', async () => {
    const under = await foldersUnder("x' or '1")
    expect(under.ok).toBe(false)
    expect(drive.listCalls).toBe(0)
  })
})
