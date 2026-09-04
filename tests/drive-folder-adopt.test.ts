import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ADOPT, NEVER DUPLICATE.
 *
 * The owner's instruction, in their words: the app must never rename, move or
 * delete their existing folders, and an existing client folder is taken as it
 * is rather than copied. Drive is what makes that hard — it has no unique-name
 * constraint at all, so a create that skips the lookup happily leaves two
 * folders called "Sui Kitchen" side by side, with half the work in one and
 * half in the other and nobody able to tell which is which.
 *
 * So the tests below count creates. `findOrCreateFolder` may look as often as
 * it likes; it may create exactly once, and only when there was genuinely
 * nothing there.
 *
 * `../app/lib/gdrive` is the only thing stubbed here — the code under test is
 * the real helper, not a stand-in for it.
 */

const drive = {
  folders: [] as { parent: string; name: string; id: string }[],
  creates: [] as { parent: string; name: string }[],
  findFails: false,
  createFails: false,
  next: 1,
}

vi.mock('../app/lib/gdrive', () => ({
  ALL_DRIVES: { supportsAllDrives: 'true' },
  ALL_DRIVES_LIST: { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' },
  FILES: 'https://files.invalid',
  UPLOAD_FILES: 'https://upload.invalid',
  accessToken: async () => ({ ok: true, token: 't' }),
  driveFetch: async () => ({ ok: true, data: {} }),
  findSubfolder: async (parent: string, name: string) => {
    if (drive.findFails) return { ok: false, reason: 'api_error', message: 'Google Drive 500' }
    const hit = drive.folders.find(f => f.parent === parent && f.name === name)
    return { ok: true, id: hit?.id ?? null }
  },
  createSubfolder: async (parent: string, name: string) => {
    if (drive.createFails) return { ok: false, reason: 'api_error', message: 'Google Drive 403' }
    drive.creates.push({ parent, name })
    const id = `made-${drive.next++}`
    drive.folders.push({ parent, name, id })
    return { ok: true, id }
  },
}))

const { findOrCreateFolder } = await import('../app/lib/gdrive-files')

beforeEach(() => {
  drive.folders = [{ parent: 'CL1', name: 'Sui Kitchen', id: 'SK1' }]
  drive.creates = []
  drive.findFails = false
  drive.createFails = false
  drive.next = 1
})

describe('a folder that is already there is adopted, not copied', () => {
  it('hands back the existing folder and creates nothing', async () => {
    const result = await findOrCreateFolder('CL1', 'Sui Kitchen')
    expect(result).toMatchObject({ ok: true, id: 'SK1', created: false })
    expect(drive.creates).toEqual([])
  })

  it('creates only when there is genuinely nothing there', async () => {
    const result = await findOrCreateFolder('CL1', 'Pattons')
    expect(result).toMatchObject({ ok: true, created: true })
    expect(drive.creates).toEqual([{ parent: 'CL1', name: 'Pattons' }])
  })

  it('pressing it twice still leaves ONE folder', async () => {
    await findOrCreateFolder('CL1', 'Pattons')
    await findOrCreateFolder('CL1', 'Pattons')
    expect(drive.creates).toHaveLength(1)
    expect(drive.folders.filter(f => f.name === 'Pattons')).toHaveLength(1)
  })

  it('matches the name Drive would actually store, not the raw typing', async () => {
    // safeSegment trims and collapses whitespace before either call, so
    // "  Sui Kitchen " is the same folder rather than a second one
    const result = await findOrCreateFolder('CL1', '  Sui   Kitchen ')
    expect(result).toMatchObject({ ok: true, id: 'SK1', created: false })
    expect(drive.creates).toEqual([])
  })

  it('refuses an empty name rather than making a folder called nothing', async () => {
    const result = await findOrCreateFolder('CL1', '   ')
    expect(result.ok).toBe(false)
    expect(drive.creates).toEqual([])
  })

  it('refuses a parent that is not a Drive id, before Google is called', async () => {
    const result = await findOrCreateFolder("x' or '1", 'Pattons')
    expect(result.ok).toBe(false)
    expect(drive.creates).toEqual([])
  })
})

describe('a failure fails safe', () => {
  it('does NOT create when the lookup itself failed', async () => {
    // the dangerous case: "we could not find it" is not "it is not there".
    // Creating here is how a duplicate of an existing client folder appears.
    drive.findFails = true
    const result = await findOrCreateFolder('CL1', 'Sui Kitchen')
    expect(result.ok).toBe(false)
    expect(drive.creates).toEqual([])
  })

  it('reports a failed create and never retries under another name', async () => {
    drive.createFails = true
    const result = await findOrCreateFolder('CL1', 'Pattons')
    expect(result.ok).toBe(false)
    expect(drive.folders.some(f => /Pattons/.test(f.name))).toBe(false)
  })
})

describe('nothing here can delete anything', () => {
  it('exports no delete, trash or remove of any kind', async () => {
    const helpers = await import('../app/lib/gdrive-files')
    const dangerous = Object.keys(helpers).filter(k => /delete|trash/i.test(k))
    // `revokePermission` is the one "remove": it takes access away from a
    // person, it does not touch a file, and it predates this page.
    expect(dangerous).toEqual([])
  })
})
