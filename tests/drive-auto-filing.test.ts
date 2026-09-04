import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * AUTOMATIC FILING TO DRIVE IS OFF, AND THIS IS WHAT PROVES IT.
 *
 * The owner's ruling was "remove any auto upload feature to the drive —
 * disabled": the HQ folder is the agency's real archive, and the app is a
 * guest in it. What makes that true in code is one switch
 * (`gdrive-policy.ts`), and what makes it STAY true is this file, because a
 * new mirror caller added next month would otherwise start filing again with
 * nothing to stop it.
 *
 * Three kinds of case, and each catches something the others cannot:
 *
 *  1. EVERY entry point is called for real, with Google and Inngest replaced
 *     by counters. Zero requests, zero queued events, zero `drive_files` rows.
 *     A guard that returns the wrong shape, or one that runs after the first
 *     `fetch`, fails here.
 *  2. The same harness with the switch ON files normally — without which case
 *     1 would pass just as happily against code that had been deleted.
 *  3. A read of the source itself: every exported function in the two hook
 *     modules that can write is named here, and must mention
 *     `skipAutoFiling`. That is what catches a NEW exported writer, which the
 *     table in case 1 cannot know about.
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

/** Every request that reached "Google", and every event that reached Inngest. */
const calls: { method: string; url: string }[] = []
const events: unknown[] = []

vi.mock('../app/inngest/client', () => ({
  inngest: { send: vi.fn(async (e: unknown) => { events.push(e); return {} }) },
}))

const FILES = 'https://www.googleapis.com/drive/v3/files'
let nextId = 1
let folders: Record<string, { name: string; parent: string }> = {}

const ok = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' },
})

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input)
  const method = init?.method ?? 'GET'
  calls.push({ method, url })
  if (!url.startsWith(FILES)) throw new Error(`unexpected request: ${method} ${url}`)

  const body = init?.body ? JSON.parse(String(init.body)) : null
  if (method === 'POST' && !url.includes('/permissions')) {
    const id = `new-${nextId++}`
    folders[id] = { name: String(body.name), parent: String(body.parents?.[0] ?? '') }
    return ok({ id, name: body.name })
  }
  if (url.includes('/permissions')) return ok({ id: 'perm-1', permissions: [] })
  if (method === 'PATCH') return ok({ id: 'patched' })
  if (method === 'GET' && url.startsWith(`${FILES}?`)) {
    const q = new URL(url).searchParams.get('q') ?? ''
    const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? ''
    const wanted = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'")
    return ok({
      files: Object.entries(folders)
        .filter(([, f]) => f.parent === parent)
        .filter(([, f]) => wanted === undefined || f.name === wanted)
        .map(([id, f]) => ({ id, name: f.name })),
    })
  }
  if (method === 'GET') {
    const id = decodeURIComponent(url.slice(FILES.length + 1).split('?')[0])
    const f = folders[id]
    return f ? ok({ id, name: f.name, trashed: false }) : new Response('gone', { status: 404 })
  }
  throw new Error(`unexpected request: ${method} ${url}`)
})

const hooks = await import('../app/lib/gdrive-hooks')
const mirror = await import('../app/lib/gdrive-mirror')
const members = await import('../app/lib/gdrive-members')
const { autoFilingEnabled, resetAutoFilingLog } = await import('../app/lib/gdrive-policy')

/* ── the world these run in ─────────────────────────────────────────────── */

const ITEM = 'a1b2c3d4-0000-4000-8000-000000000001'
const BATCH = 'b1b2c3d4-0000-4000-8000-000000000002'
const FILE_URL = 'https://media.mdmmarketing.com.au/cut.mp4'

const batch = {
  id: BATCH,
  client_id: 'c1',
  title: 'Content Day',
  shoot_date: '2026-09-20',
  created_at: '2026-09-01T00:00:00.000Z',
  drive_folder_id: null as string | null,
}

const item = {
  id: ITEM,
  client_id: 'c1',
  batch_id: BATCH,
  title: 'The launch reel',
  content_type: 'reel',
  work_kind_id: null,
  raw_assets_url: null,
  drive_folder_id: null,
}

let fake: ReturnType<typeof seedDb>

function seed() {
  return seedDb({
    drive_connection: [{
      id: 'team',
      account_email: 'tech@mdmmarketing.com.au',
      account_name: 'MD Media',
      refresh_token_encrypted: 'enc:refresh',
      root_name: 'Clients',
      root_folder_id: 'root-1',
      connected_at: '2026-09-01T00:00:00.000Z',
      connected_by: 'owner@example.invalid',
      created_at: '2026-09-01T00:00:00.000Z',
    }] as unknown as Row[],
    clients: [{
      id: 'c1', name: 'Acme', slug: 'acme', status: 'active',
      drive_folder_id: 'f-acme', created_at: '2026-01-01T00:00:00.000Z',
    }] as unknown as Row[],
    content_items: [{
      ...item, status: 'in_progress', updated_at: new Date().toISOString(),
      raw_assets: [{ url: FILE_URL, name: 'cut.mp4' }],
    }] as unknown as Row[],
    batches: [{ ...batch, status: 'planned' }] as unknown as Row[],
    asset_versions: [{
      id: `${ITEM}__1`, item_id: ITEM, version_number: 1,
      file_url: FILE_URL, files: [{ url: FILE_URL, name: 'cut.mp4', type: 'video' }],
      dropbox_url: '', drive_url: '', notes: null, uploaded_by: 'u1',
    }] as unknown as Row[],
    team_users: [{
      id: 'u1', email: 'freelancer@gmail.com', name: 'Sam', role: 'editor',
      employment_type: 'contractor', active_status: true,
    }] as unknown as Row[],
    drive_files: [],
  })
}

/**
 * EVERY door into automatic filing, called the way its caller calls it.
 *
 * The fire-and-forget `on…` wrappers are in here beside the awaitable bodies
 * on purpose: they are what the routes actually call, and a guard placed only
 * on the body would still let the wrapper schedule the work.
 */
const ENTRY_POINTS: [name: string, run: () => unknown | Promise<unknown>][] = [
  ['ensureShootFoldersNow', () => hooks.ensureShootFoldersNow(batch)],
  ['onBatchCreated', () => hooks.onBatchCreated(batch)],
  ['renameShootFolderNow', () => hooks.renameShootFolderNow({ ...batch, drive_folder_id: 'f-shoot' })],
  ['onShootDateChanged', () => hooks.onShootDateChanged({ ...batch, drive_folder_id: 'f-shoot' })],
  ['ensureItemFoldersNow', () => hooks.ensureItemFoldersNow([item])],
  ['onItemsCreated', () => hooks.onItemsCreated([item])],
  ['ensureBrandFolderNow', () => hooks.ensureBrandFolderNow('c1')],
  ['requestMirror', () => mirror.requestMirror([
    { item_id: ITEM, source_url: FILE_URL, name: 'cut.mp4', target: 'item' },
  ])],
  ['mirrorFiles', () => mirror.mirrorFiles([
    { item_id: ITEM, source_url: FILE_URL, name: 'cut.mp4', target: 'item' },
  ])],
  ['mirrorRawAssets', () => mirror.mirrorRawAssets(ITEM, [{ url: FILE_URL, name: 'cut.mp4' }])],
  ['mirrorVersion', () => mirror.mirrorVersion(ITEM, 2, FILE_URL)],
  ['mirrorVersionSlides', () => mirror.mirrorVersionSlides(ITEM, 2, [
    { url: FILE_URL, name: 'cut.mp4', type: 'video' },
  ])],
  ['mirrorLatestVersion', () => mirror.mirrorLatestVersion(ITEM, 'final')],
  ['mirrorLatestVersionSoon', () => mirror.mirrorLatestVersionSoon(ITEM, 'final')],
  ['mirrorIntakeFiles', () => mirror.mirrorIntakeFiles('c1', [
    { block_id: 'b1', label: 'Logo', filename: 'logo.png', url: 'https://media.mdmmarketing.com.au/logo.png' },
  ])],
  ['mirrorBrandDoc', () => mirror.mirrorBrandDoc('c1', 'https://media.mdmmarketing.com.au/brand.pdf', 'brand.pdf')],
  ['mirrorFileNow', () => mirror.mirrorFileNow({
    item_id: ITEM, source_url: FILE_URL, name: 'cut.mp4', target: 'item',
  })],
  ['sweepMissingMirrors', () => mirror.sweepMissingMirrors()],
  ['syncDriveMembers', () => members.syncDriveMembers()],
  ['onTeamChanged', () => members.onTeamChanged('a test')],
]

/** The fire-and-forget paths hand their work to `after()`, which throws
 *  outside a request and falls back to a detached promise. Let the microtask
 *  queue drain, or "nothing happened" would only mean "nothing has happened
 *  YET" — the failure mode this whole file exists to rule out. */
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5)) }

const filingBefore = process.env.DRIVE_AUTO_FILING

beforeEach(() => {
  calls.length = 0
  events.length = 0
  nextId = 1
  folders = {
    'root-1': { name: 'Clients', parent: 'hq' },
    'f-acme': { name: 'Acme', parent: 'root-1' },
    'f-shoot': { name: '2026-08 Content Day', parent: 'f-acme' },
  }
  delete process.env.DRIVE_AUTO_FILING
  resetAutoFilingLog()
  fake = seed()
})

afterEach(() => {
  fake?.restore()
  if (filingBefore === undefined) delete process.env.DRIVE_AUTO_FILING
  else process.env.DRIVE_AUTO_FILING = filingBefore
})

/* ── 1. with the switch off, nothing at all reaches Drive ───────────────── */

describe('with automatic filing off (the default)', () => {
  it('is off unless the environment says exactly "1"', () => {
    expect(autoFilingEnabled()).toBe(false)
    for (const v of ['', '0', 'true', 'yes', 'on', '2']) {
      process.env.DRIVE_AUTO_FILING = v
      expect(autoFilingEnabled()).toBe(false)
    }
    process.env.DRIVE_AUTO_FILING = '1'
    expect(autoFilingEnabled()).toBe(true)
  })

  it.each(ENTRY_POINTS)('%s asks Google for nothing and records nothing', async (_name, run) => {
    await run()
    await settle()
    expect(calls).toEqual([])
    expect(events).toEqual([])
    expect(fake.rows('drive_files')).toHaveLength(0)
    // and no folder id was written back onto the work, either — a recorded
    // folder that does not exist is worse than none
    expect((fake.rows('batches')[0] as unknown as { drive_folder_id: unknown }).drive_folder_id)
      .toBeFalsy()
    expect((fake.rows('content_items')[0] as unknown as { drive_folder_id: unknown }).drive_folder_id)
      .toBeFalsy()
  })

  it('says so in the log rather than failing silently', async () => {
    const said: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      said.push(a.map(String).join(' '))
    })
    await hooks.ensureShootFoldersNow(batch)
    log.mockRestore()
    expect(said.some(l => l.includes('[gdrive] automatic filing is off'))).toBe(true)
  })

  it('tells the Re-share button the truth instead of pretending', async () => {
    const res = await members.syncDriveMembers()
    expect(res.ok).toBe(true)
    expect(res.reason).toBe('auto_filing_off')
    expect(res.message).toMatch(/only reads Google Drive/)
    expect(res.added).toEqual([])
    expect(calls).toEqual([])
  })

  it('the Inngest job body refuses an event queued before the switch went off', async () => {
    const out = await mirror.mirrorFileNow({
      item_id: ITEM, source_url: FILE_URL, name: 'cut.mp4', target: 'item',
    })
    expect(out).toEqual({ status: 'skipped', detail: 'automatic filing is off' })
    expect(calls).toEqual([])
    expect(fake.rows('drive_files')).toHaveLength(0)
  })
})

/* ── 2. the same harness, switch on — so case 1 means something ─────────── */

describe('with DRIVE_AUTO_FILING=1', () => {
  beforeEach(() => { process.env.DRIVE_AUTO_FILING = '1' })

  it('makes the shoot folder it would have made', async () => {
    const id = await hooks.ensureShootFoldersNow(batch)
    expect(id).toBeTruthy()
    expect(calls.some(c => c.method === 'POST')).toBe(true)
  })

  it('queues a version for Drive', async () => {
    mirror.mirrorVersionSlides(ITEM, 2, [{ url: FILE_URL, name: 'cut.mp4', type: 'video' }])
    await settle()
    expect(events).toHaveLength(1)
  })

  /**
   * THE PICKER IS NOT A ROUND TRIP.
   *
   * A file the composer's Google Drive tab brought across is already in the
   * agency's Drive — it is where it was just picked from. Copying it back
   * would put a second copy of the same footage beside the first under a
   * `v2 - …` name. True even here, with filing switched on: this one is not
   * about the switch, it is about the picker.
   */
  it('never copies a picked Drive file back, even so', async () => {
    mirror.mirrorVersionSlides(ITEM, 2, [
      { url: FILE_URL, name: 'cut.mp4', type: 'video', source: 'drive', drive_file_id: 'gd-1' },
    ])
    await settle()
    expect(events).toEqual([])
  })

  it('mirrors the uploads in a mixed carousel and leaves the picked one alone', async () => {
    mirror.mirrorVersionSlides(ITEM, 3, [
      { url: FILE_URL, name: 'cut.mp4', type: 'video', source: 'drive', drive_file_id: 'gd-1' },
      { url: 'https://media.mdmmarketing.com.au/card.jpg', name: 'card.jpg', type: 'image' },
    ])
    await settle()
    const sent = (events[0] ?? []) as { data: { source_url: string } }[]
    expect(sent).toHaveLength(1)
    expect(sent[0].data.source_url).toBe('https://media.mdmmarketing.com.au/card.jpg')
  })
})

/* ── 3. the source itself, so a new writer cannot slip past ─────────────── */

/**
 * Everything the two hook modules export that can WRITE to Drive, and the few
 * that provably cannot.
 *
 * Listed rather than inferred, because "can this write" is a judgement and a
 * clever regex making it would be the thing under test. A new export lands in
 * neither list and fails the last case, which is the point: somebody has to
 * decide which list it belongs in.
 */
const MUST_GUARD: Record<string, string[]> = {
  'app/lib/gdrive-hooks.ts': [
    'ensureShootFoldersNow', 'onBatchCreated', 'renameShootFolderNow',
    'onShootDateChanged', 'ensureItemFoldersNow', 'onItemsCreated',
    'ensureBrandFolderNow',
  ],
  'app/lib/gdrive-mirror.ts': [
    'requestMirror', 'mirrorFiles', 'mirrorRawAssets', 'mirrorVersion',
    'mirrorVersionSlides', 'mirrorLatestVersion', 'mirrorLatestVersionSoon',
    'mirrorIntakeFiles', 'mirrorBrandDoc', 'mirrorFileNow', 'sweepMissingMirrors',
  ],
  'app/lib/gdrive-members.ts': ['syncDriveMembers', 'onTeamChanged'],
}

/** Exported functions that read and never write, so they are allowed through
 *  unguarded — each one named, with why. */
const READ_ONLY = new Set([
  // a pure array difference over what the caller already had
  'newRawAssets',
  // counts rows in `drive_files`; writes nothing anywhere
  'itemMirrorProgress',
  // one sentence for the Integrations card, computed from the team table
  'driveMemberNote',
])

/**
 * Every exported function, and the text that follows it up to the next
 * top-level export — near enough to a body for "does this mention the guard",
 * and it needs no parser.
 *
 * BOTH shapes. `export function foo` was the only one this recognised, so an
 * exported arrow — `export const foo = async () => {…}` — walked straight past
 * the guard test. There are none in these three files today, which is exactly
 * when to widen it: the next writer somebody adds will be written in whichever
 * style they happen to prefer.
 */
function exportedFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  // `export function f` / `export async function f`, and the arrow form
  // `export const f = (…) =>` / `= async (…) =>` / `= function`. A plain
  // exported CONSTANT is not a function and is deliberately not matched —
  // catching those would make every string in the file something somebody has
  // to classify, and the test would be turned off within a week.
  const re = /^export (?:async )?function (\w+)|^export (?:const|let) (\w+)(?::[^=\n]*)? = (?:async )?(?:\(|function\b)/gm
  const found: { name: string; at: number }[] = []
  for (let m = re.exec(source); m; m = re.exec(source)) {
    found.push({ name: m[1] ?? m[2], at: m.index })
  }
  found.forEach((f, i) => {
    out.set(f.name, source.slice(f.at, found[i + 1]?.at ?? source.length))
  })
  return out
}

describe('the guard is in the source, not just in the cases above', () => {
  it.each(Object.entries(MUST_GUARD))('%s guards every writer', (file, names) => {
    const source = readFileSync(file, 'utf8')
    const fns = exportedFunctions(source)

    for (const name of names) {
      expect(fns.has(name), `${file} no longer exports ${name}`).toBe(true)
      expect(
        fns.get(name)!.includes('skipAutoFiling('),
        `${name} in ${file} writes to Drive without checking the filing switch`,
      ).toBe(true)
    }

    // and nothing new has appeared that nobody has classified
    const unclassified = [...fns.keys()]
      .filter(n => !names.includes(n) && !READ_ONLY.has(n))
    expect(
      unclassified,
      `new export(s) in ${file}: guard them with skipAutoFiling(), or add them`
      + ' to READ_ONLY in this test with a reason',
    ).toEqual([])
  })
})
