import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedDb } from './helpers/fake-db'
import type { Row } from '@/lib/db-types'

/**
 * A VERSION HANDED IN FROM GOOGLE DRIVE (the owner, 30 Sep 2026) — end to end against the real `@/lib/db` on the
 * fake Realtime Database: the Editor's POST, the background copy run step by step exactly as the
 * `drive-pull-folder` Inngest job runs it (list → slices → finish), and the card's files afterwards — versions,
 * pieces, Drive ids — then what the client portal makes of them. Google Drive and R2 are counters: every Drive call
 * is recorded, and each one must be a read.
 */

const ITEM = 'aaaaaaaa-0000-4000-8000-00000000d001'
const ED = { id: 'u-ed', role: 'editor', email: 'ed@x.invalid', name: 'Eden', clerk_user_id: null }
const OTHER = { id: 'u-other', role: 'editor', email: 'o@x.invalid', name: 'Omar', clerk_user_id: null }
const AM = { id: 'u-am', role: 'account_manager', email: 'am@x.invalid', name: 'Ada', clerk_user_id: null }

// Drive ids are 10+ characters of [A-Za-z0-9_-], as the link parsers require
const FOLDER = 'folderAAAA0001'
const CLIP1 = 'driveClip00001', CLIP2 = 'driveClip00002', CLIP3 = 'driveClip00003', NOTES = 'driveNotes0001'
const FOLDER_URL = `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`

const h = vi.hoisted(() => ({
  user: null as unknown as Record<string, unknown>,
  activity: [] as Record<string, unknown>[],
  events: [] as { name: string; data: Record<string, unknown> }[],
  driveCalls: [] as string[],
  drive: {} as Record<string, { name: string; mime: string; bytes: number; modified: string; parent: string; unreadable?: boolean; md5?: string; revision?: string; publicOnly?: boolean }>,
  r2: new Map<string, Buffer[]>(),
}))

vi.mock('../app/lib/authz', () => ({
  requireRole: async () => h.user,
  requireSignedIn: async () => h.user,
  AuthzError: class AuthzError extends Error {
    status: number
    constructor(message: string, status: number) { super(message); this.status = status }
  },
  authzErrorResponse: (e: unknown) => ({ error: e instanceof Error ? e.message : 'error', status: (e as { status?: number })?.status ?? 500 }),
}))
vi.mock('../app/lib/production-access', () => ({
  loadItemForUser: async (_u: unknown, id: string) => {
    const { table } = await import('@/lib/db')
    return table('content_items').get(id)
  },
}))
vi.mock('../app/lib/workflow', () => ({ logActivity: vi.fn(async (a: Record<string, unknown>) => { h.activity.push(a) }) }))
vi.mock('../app/lib/production-live', () => ({ announceItemChange: vi.fn() }))
vi.mock('../app/inngest/client', () => ({ inngest: { send: vi.fn(async (e: { name: string; data: Record<string, unknown> }) => { h.events.push(e); return {} }) } }))
vi.mock('../app/lib/stream', () => ({ previewVideos: vi.fn() }))
// GOOGLE DRIVE — only the read surface exists; each call is recorded by name
vi.mock('../app/lib/drive-folder-list', () => ({
  listFolder: async (folderId: string) => {
    h.driveCalls.push(`list:${folderId}`)
    const entries = Object.entries(h.drive).filter(([, f]) => f.parent === folderId && !f.unreadable)
      .map(([id, f]) => f.publicOnly
        // Google's public folder view: no size, no change time, no checksum (live, 30 Sep 2026)
        ? { id, name: f.name, mimeType: f.mime, size: null, modified: null, ownerName: null, ownerEmail: null, hasThumbnail: false, webViewLink: null }
        : { id, name: f.name, mimeType: f.mime, size: f.bytes, modified: f.modified, md5: f.md5 ?? null, revision: f.revision ?? null, ownerName: null, ownerEmail: null, hasThumbnail: false, webViewLink: null })
    return { entries, more: false, source: 'account', accountFailure: null }
  },
}))
vi.mock('../app/lib/drive-stream', () => ({
  driveFileMeta: async (id: string) => {
    h.driveCalls.push(`meta:${id}`)
    const f = h.drive[id]
    if (!f || f.unreadable) return null
    // a file only the public view shows: its bytes can be read, Drive says nothing about which cut it is
    return f.publicOnly ? { name: f.name, mime: f.mime, size: f.bytes, modified: null } : { name: f.name, mime: f.mime, size: f.bytes, modified: f.modified, md5: f.md5 ?? null, revision: f.revision ?? null }
  },
  driveFileSize: async (id: string) => { h.driveCalls.push(`size:${id}`); return h.drive[id]?.bytes ?? null },
  openDriveFile: async (id: string, range: string) => {
    h.driveCalls.push(`read:${id}`)
    const f = h.drive[id]
    if (!f || f.name.includes('BROKEN')) return null
    const [a, b] = /bytes=(\d+)-(\d+)/.exec(range)!.slice(1).map(Number)
    return new Response(Buffer.alloc(b - a + 1, 7))
  },
}))
vi.mock('../app/lib/storage', () => ({
  r2Configured: () => true,
  openMultipart: async (key: string) => { h.r2.set(key, []); return `up-${key}` },
  putMultipartPart: async (key: string, _u: string, n: number, bytes: Buffer) => { h.r2.get(key)!.push(bytes); return `etag-${n}` },
  closeMultipart: async (key: string) => `https://r2.test/${key}`,
  abortMultipart: async () => undefined,
}))

const { GET, POST } = await import('../app/api/production/items/[id]/drive-handin/route')
const { runPullList, runPullSlices, finishPull } = await import('../app/lib/drive-pull')
const { filesOf } = await import('../app/lib/drive-pull-core')
const { currentFiles, finalFilesOf, hasFinishedWork, stillToReplace, assetIdOf } = await import('../app/lib/final-files-core')
const { asClientVersions, clipsAtRound, assetLine, clientRoundsOf } = await import('../app/lib/editing-portal-core')
const { handInRound, versionLabel } = await import('../app/lib/edit-round-core')
const { versionSnapshot } = await import('../app/lib/final-files-core')

let fake: ReturnType<typeof seedDb>
const card = () => fake.rows('content_items').find(r => r.id === ITEM) as Record<string, any>

const list = async (url: string) => {
  const res = await GET(new Request(`https://x.test/api/production/items/${ITEM}/drive-handin?url=${encodeURIComponent(url)}`), { params: Promise.resolve({ id: ITEM }) })
  return { status: res.status, json: await res.json() as any }
}
const handIn = async (body: Record<string, unknown>) => {
  const res = await POST(new Request(`https://x.test/api/production/items/${ITEM}/drive-handin`, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ITEM }) })
  return { status: res.status, json: await res.json() as any }
}
/** the drive-pull-folder Inngest job, step for step (app/inngest/functions.ts drivePullFolder) */
const runJob = async () => {
  const e = h.events.shift()!
  expect(e.name).toBe('drive/pull.folder')          // the EXISTING job's event — no new Inngest function
  const id = String(e.data.pull_id)
  const listed = await runPullList(id, e.data.version as number)
  if (listed.note) return
  const { table } = await import('@/lib/db')
  const ids = filesOf(await table('drive_pulls').get(id) as never).filter(f => f.status !== 'done').map(f => f.id)
  for (const fid of ids) for (let n = 0; n < 50; n++) { const r = await runPullSlices(id, fid); if (r.done) break }
  await finishPull(id)
}

const MOD1 = '2026-09-30T01:00:00.000Z', MOD2 = '2026-09-30T05:00:00.000Z'
const seedDrive = () => {
  h.drive = {
    [CLIP1]: { name: 'Script 1.mp4', mime: 'video/mp4', bytes: 1000, modified: MOD1, parent: FOLDER },
    [CLIP2]: { name: 'Script 2.mp4', mime: 'video/mp4', bytes: 2000, modified: MOD1, parent: FOLDER },
    [NOTES]: { name: 'notes.txt', mime: 'text/plain', bytes: 10, modified: MOD1, parent: FOLDER },
  }
}
const seed = (cardRow: Record<string, unknown>) => {
  fake = seedDb({
    content_items: [{ id: ITEM, client_id: 'c1', title: 'First Shoot', owner_id: ED.id, scheduler_ids: [], current_version_number: 0, ...cardRow }] as unknown as Row[],
    team_users: [ED, OTHER, AM] as unknown as Row[],
  })
}

beforeEach(() => {
  h.user = ED
  h.activity = []; h.events = []; h.driveCalls = []; h.r2 = new Map()
  seedDrive()
})
afterEach(() => fake?.restore())

describe('handing a version in from a Drive link', () => {
  it('lists what the link holds, then copies the picked files in the background and makes them Version 1 — each keeping its Drive id', async () => {
    seed({ status: 'in_progress' })
    const l = await list(FOLDER_URL)
    expect(l.status).toBe(200)
    expect(l.json.files.map((f: any) => f.id).sort()).toEqual([CLIP1, CLIP2, NOTES].sort())

    const r = await handIn({ url: FOLDER_URL, ids: [CLIP2, CLIP1] })   // the editor's order
    expect(r.status).toBe(200)
    expect(r.json.round).toBe(1)
    // recorded as copying; nothing on the card yet — the page is never blocked on the bytes
    expect(card().drive_handins).toHaveLength(1)
    expect(card().drive_handins[0]).toMatchObject({ status: 'copying', drive_ids: [CLIP2, CLIP1] })
    expect(finalFilesOf(card())).toEqual([])

    await runJob()
    const files = finalFilesOf(card())
    expect(files.map(f => f.name)).toEqual(['Script 2.mp4', 'Script 1.mp4'])
    expect(files.map(f => f.drive_file_id)).toEqual([CLIP2, CLIP1])
    expect(files.every(f => f.source === 'drive' && f.version === 1 && f.url.startsWith('https://r2.test/'))).toBe(true)
    // the notes file was not picked, so it was never read or copied
    expect(h.driveCalls.some(c => c === `read:${NOTES}`)).toBe(false)
    expect(card().drive_handins[0]).toMatchObject({ status: 'done', settled_round: 1, file_ids: files.map(f => f.id) })
    expect(hasFinishedWork(card() as never)).toBe(true)
    // the link is NOT saved as the finished edit (83efd377): the work is the files
    expect(card().link_final ?? null).toBeNull()
    expect(card().link_url ?? null).toBeNull()
    expect(h.activity.map(a => a.action)).toEqual(['drive_handin_started', 'drive_handin_done'])
  })

  it('every Drive call is a read — listing, metadata and byte ranges, nothing else', async () => {
    seed({ status: 'in_progress' })
    await list(FOLDER_URL)
    await handIn({ url: FOLDER_URL, ids: [CLIP1] })
    await runJob()
    expect(h.driveCalls.length).toBeGreaterThan(0)
    expect(h.driveCalls.every(c => /^(list|meta|size|read):/.test(c))).toBe(true)
  })

  it('refuses a link the connected Drive cannot read, in the owner’s words', async () => {
    seed({ status: 'in_progress' })
    h.drive[CLIP1].unreadable = true
    const r = await list(`https://drive.google.com/file/d/${CLIP1}/view`)
    expect(r.status).toBe(422)
    expect(r.json.error).toMatch(/^This link isn’t shared with MD Media’s Drive/)
    const p = await handIn({ url: `https://drive.google.com/file/d/${CLIP1}/view`, ids: [CLIP1] })
    expect(p.status).toBe(422)
    expect(h.events).toHaveLength(0)
  })

  it('a single-file link (open?id=) is handed in as one file', async () => {
    seed({ status: 'in_progress' })
    const r = await handIn({ url: `https://drive.google.com/open?id=${CLIP1}`, ids: [CLIP1] })
    expect(r.status).toBe(200)
    await runJob()
    expect(finalFilesOf(card()).map(f => f.drive_file_id)).toEqual([CLIP1])
  })

  it('the same people who may upload files may hand in from Drive — nobody else', async () => {
    seed({ status: 'in_progress' })
    h.user = OTHER
    expect((await list(FOLDER_URL)).status).toBe(403)
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(403)
    h.user = AM
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(200)
  })

  it('an approved card is not handed in to; while the client looks only a manager may', async () => {
    seed({ status: 'approved_for_scheduling' })
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(409)
    fake.restore(); seed({ status: 'client_review' })
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(409)
    h.user = AM
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(200)
  })

  it('a file that does not copy stops the whole hand-in, named — never a half version', async () => {
    seed({ status: 'in_progress' })
    h.drive[CLIP2].name = 'Script 2 BROKEN.mp4'
    await handIn({ url: FOLDER_URL, ids: [CLIP1, CLIP2] })
    await runJob()
    expect(finalFilesOf(card())).toEqual([])
    expect(card().drive_handins[0].status).toBe('failed')
    expect(card().drive_handins[0].error).toMatch(/Nothing was handed in .*Script 2 BROKEN\.mp4/)
    // and it may be tried again
    h.drive[CLIP2].name = 'Script 2.mp4'
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1, CLIP2] })).status).toBe(200)
    await runJob()
    expect(finalFilesOf(card())).toHaveLength(2)
  })

  it('one hand-in at a time: a second while the first is copying is refused', async () => {
    seed({ status: 'in_progress' })
    expect((await handIn({ url: FOLDER_URL, ids: [CLIP1] })).status).toBe(200)
    const second = await handIn({ url: FOLDER_URL, ids: [CLIP2] })
    expect(second.status).toBe(409)
  })

  it('the same Drive file picked twice, or handed in again unchanged, is not copied or added twice', async () => {
    seed({ status: 'in_progress' })
    await handIn({ url: FOLDER_URL, ids: [CLIP1, CLIP1] })
    expect(card().drive_handins[0].drive_ids).toEqual([CLIP1])
    await runJob()
    const reads = h.driveCalls.filter(c => c === `read:${CLIP1}`).length
    await handIn({ url: FOLDER_URL, ids: [CLIP1] })
    await runJob()
    expect(finalFilesOf(card())).toHaveLength(1)
    expect(h.driveCalls.filter(c => c === `read:${CLIP1}`).length).toBe(reads)   // the copy already made was reused
    expect(card().drive_handins[1]).toMatchObject({ status: 'done', carried: [CLIP1], file_ids: [] })
  })
})

describe('a files-only card (uploads, never a Drive link) takes its next version from Drive', () => {
  // Version 1 was uploaded: two pieces, went to the client, who commented on Script 1 and approved Script 2,
  // then asked for Script 1 to change
  const v1 = [
    { id: 'f_up1', name: 'Script 1.mp4', url: 'https://r2.test/up/s1.mp4', mime: 'video/mp4', size: 900, version: 1, uploaded_at: '2026-09-20T00:00:00.000Z', by: ED.id },
    { id: 'f_up2', name: 'Script 2.mp4', url: 'https://r2.test/up/s2.mp4', mime: 'video/mp4', size: 800, version: 1, uploaded_at: '2026-09-20T00:00:01.000Z', by: ED.id },
  ]
  const sentBack = {
    status: 'client_changes_requested', edit_round: 1, client_round: 1, client_rounds: [1],
    final_files: v1, change_assets: ['f_up1'], change_note: 'Tighten the hook', change_note_at: '2026-09-25T00:00:00.000Z',
    clip_approvals: [{ file_id: 'f_up2', by: 'Client', at: '2026-09-24T00:00:00.000Z' }],
  }

  it('the named piece gets its Version 2 from Drive in its own line; the approved one carries forward untouched', async () => {
    seed(sentBack)
    expect(handInRound(card() as never)).toBe(2)
    // the popup's guess: Script 1.mp4 in Drive is the piece of that name
    const l = await list(FOLDER_URL)
    expect(l.json.map[CLIP1]).toBe('f_up1')
    expect(l.json.map[CLIP2]).toBe('f_up2')
    // the editor hands in only the changed clip
    await handIn({ url: FOLDER_URL, ids: [CLIP1], map: { [CLIP1]: 'f_up1' } })
    await runJob()
    const all = finalFilesOf(card())
    expect(all).toHaveLength(3)
    // nothing earlier lost or renumbered
    expect(all.slice(0, 2)).toEqual(finalFilesOf({ final_files: v1 }))
    const fresh = all[2]
    expect(fresh).toMatchObject({ asset_id: 'f_up1', replaces: 'f_up1', version: 2, drive_file_id: CLIP1, source: 'drive' })
    expect(currentFiles(card()).map(f => f.id)).toEqual([fresh.id, 'f_up2'])
    expect(stillToReplace(card() as never)).toEqual([])
    expect(hasFinishedWork(card() as never)).toBe(true)
    // the approval stays on the piece that was approved
    expect(card().clip_approvals).toEqual(sentBack.clip_approvals)
  })

  it('a piece that was not asked to change is left as it is, and the card says so', async () => {
    seed(sentBack)
    h.drive[CLIP2].modified = MOD2
    await handIn({ url: FOLDER_URL, ids: [CLIP1, CLIP2] })   // no map: the Drive names decide
    await runJob()
    const hi = card().drive_handins[0]
    expect(hi.status).toBe('done')
    expect(hi.file_ids).toHaveLength(1)
    expect(hi.skipped).toEqual([{ drive_id: CLIP2, why: 'Script 2.mp4 was not asked to change — it stays as it is' }])
    expect(currentFiles(card()).find(f => assetIdOf(f) === 'f_up2')!.id).toBe('f_up2')
  })

  it('the portal: Version 2 shows the new cut, Version 1 is still there as "Before" with the client’s comments on it', async () => {
    seed(sentBack)
    await handIn({ url: FOLDER_URL, ids: [CLIP1], map: { [CLIP1]: 'f_up1' } })
    await runJob()
    // the card goes back to the client with Version 2 (performTransition adds the round to client_rounds)
    const c = { ...card(), status: 'client_review', edit_round: 2, client_round: 2, client_rounds: [1, 2] } as Record<string, any>
    // the clips as editing-portal.getEditingPortal builds them from final_files
    const clips = finalFilesOf(c).map(f => ({ id: f.id, version: f.version, asset_id: assetIdOf(f), carries: true, retired_round: f.retired_round ?? null }))
    const client = asClientVersions(clips, clientRoundsOf(c))
    const v2 = clipsAtRound(client, 2), v1c = clipsAtRound(client, 1)
    const newCut = finalFilesOf(c)[2]
    expect(v2.map(x => x.id)).toEqual([newCut.id, 'f_up2'])
    expect(v1c.map(x => x.id)).toEqual(['f_up1', 'f_up2'])
    // "This clip: New cut — Version 2 / Before — Version 1"
    expect(assetLine(client, v2[0]).map(x => [x.id, x.version])).toEqual([[newCut.id, 2], ['f_up1', 1]])
    // the client's comments hang off the file id they were written on — Version 1's — and that file is kept
    const comment = { video_file_id: 'f_up1', body: 'Tighten the hook' }
    expect(client.some(x => x.id === comment.video_file_id && x.version === 1)).toBe(true)
  })
})

describe('a card that was already Drive-linked (the old hand-in) takes a Drive version as files', () => {
  it('its old link copies are adopted as Version 1 pieces first; the new Drive cut is Script 1’s Version 2, matched by Drive id', async () => {
    // the old way: link_final Drive link, its copy on a 'finished' pull row, no files on the card
    const OLD = 'oldFolder00001'
    seed({
      status: 'client_changes_requested', edit_round: 1, client_round: 1, client_rounds: [1],
      link_url: `https://drive.google.com/drive/folders/${OLD}`, link_kind: 'drive', link_final: true,
      change_note_at: '2026-09-25T00:00:00.000Z',
    })
    const { table } = await import('@/lib/db')
    await table('drive_pulls').insert({
      id: `folder-${OLD}@${ITEM}`, folder_id: OLD, folder_url: `https://drive.google.com/drive/folders/${OLD}`, kind: 'item', scope_id: ITEM,
      purpose: 'finished', status: 'done', total_files: 2, total_bytes: 3000, done_files: 2, done_bytes: 3000,
      files: [
        { id: CLIP1, name: 'Script 1.mp4', mime: 'video/mp4', size: 1000, done: 1000, url: 'https://r2.test/old/s1.mp4', status: 'done', version: 1, modified: MOD1 },
        { id: CLIP3, name: 'Script 3.mp4', mime: 'video/mp4', size: 3000, done: 3000, url: 'https://r2.test/old/s3.mp4', status: 'done', version: 1, modified: MOD1 },
      ],
      created_at: '2026-09-18T00:00:00.000Z', updated_at: '2026-09-18T00:00:00.000Z',
    } as never)
    h.drive[CLIP1].modified = MOD2; h.drive[CLIP1].bytes = 1100   // Script 1 re-exported in Drive under the same file (a new export is a new size)
    await handIn({ url: FOLDER_URL, ids: [CLIP1] })
    await runJob()
    const all = finalFilesOf(card())
    // Version 1 as it was: the two old clips, under their Drive ids (comments and approvals hang off those)
    expect(all.filter(f => f.version === 1).map(f => f.id)).toEqual([CLIP1, CLIP3])
    const v2 = all.filter(f => f.version === 2)
    expect(v2).toHaveLength(1)
    expect(v2[0]).toMatchObject({ asset_id: CLIP1, replaces: CLIP1, drive_file_id: CLIP1, source: 'drive' })
    expect(currentFiles(card()).map(f => assetIdOf(f))).toEqual([CLIP1, CLIP3])
    // the old link is left exactly as it was — its earlier round still opens
    expect(card().link_url).toBe(`https://drive.google.com/drive/folders/${OLD}`)
  })
})

describe('the editor hands in the WHOLE Drive link again (the owner, 30 Sep 2026: "submit the Drive link again and all will become Version 2")', () => {
  const MD5 = (c: string) => c.repeat(32)
  const setCard = async (patch: Record<string, unknown>) => {
    const { table } = await import('@/lib/db')
    await table('content_items').update(ITEM, patch as never)
  }
  const reads = (id: string) => h.driveCalls.filter(c => c === `read:${id}`).length
  beforeEach(() => {
    h.drive[CLIP1].md5 = MD5('a'); h.drive[CLIP2].md5 = MD5('b')
  })

  it('no picking: every picture and clip in the link is the version (the notes file is not)', async () => {
    seed({ status: 'in_progress' })
    const r = await handIn({ url: FOLDER_URL })
    expect(r.status).toBe(200)
    expect(r.json.hand_in).toMatchObject({ whole: true })
    await runJob()
    expect(finalFilesOf(card()).map(f => f.name).sort()).toEqual(['Script 1.mp4', 'Script 2.mp4'])
    expect(finalFilesOf(card()).map(f => f.drive_md5).sort()).toEqual([MD5('a'), MD5('b')])
  })

  it('(a) the quality check sends it back; a clip RE-EXPORTED OVER ITSELF (same Drive id, same size, new checksum) is its new cut; the other is kept, not copied again; still Version 1', async () => {
    seed({ status: 'in_progress' })
    await handIn({ url: FOLDER_URL }); await runJob()
    await setCard({ status: 'revision_required', change_note_at: new Date().toISOString() })
    const before2 = reads(CLIP2)
    h.drive[CLIP1].md5 = MD5('c'); h.drive[CLIP1].modified = MOD2
    await handIn({ url: FOLDER_URL }); await runJob()
    const hi = card().drive_handins[1]
    expect(hi.status).toBe('done')
    expect(hi.carried).toEqual([CLIP2])
    expect(hi.file_ids).toHaveLength(1)
    expect(reads(CLIP2)).toBe(before2)
    const snap = versionSnapshot(card(), 1)
    expect(snap.map(f => [f.name, f.drive_md5])).toEqual([['Script 1.mp4', MD5('c')], ['Script 2.mp4', MD5('b')]])
    // the earlier cut of Script 1 is kept, under its own id (the comments on it with it), in the piece's line
    expect(finalFilesOf(card()).filter(f => f.drive_file_id === CLIP1).map(f => f.drive_md5)).toEqual([MD5('a'), MD5('c')])
    expect(versionLabel(card() as never, handInRound(card() as never))).toBe('Version 1')
    expect(hasFinishedWork(card() as never)).toBe(true)
  })

  it('(b) a different Drive file with a matching name replaces that piece', async () => {
    seed({ status: 'in_progress' })
    await handIn({ url: FOLDER_URL }); await runJob()
    const s2 = finalFilesOf(card()).find(f => f.name === 'Script 2.mp4')!
    await setCard({ status: 'revision_required', change_note_at: new Date().toISOString() })
    delete h.drive[CLIP2]
    h.drive[CLIP3] = { name: 'Script 2.mp4', mime: 'video/mp4', bytes: 2100, modified: MOD2, parent: FOLDER, md5: MD5('d') }
    await handIn({ url: FOLDER_URL }); await runJob()
    const fresh = finalFilesOf(card()).find(f => f.drive_file_id === CLIP3)!
    expect(fresh).toMatchObject({ asset_id: s2.id, replaces: s2.id })
    expect(currentFiles(card()).map(f => f.name)).toEqual(['Script 1.mp4', 'Script 2.mp4'])
  })

  it('(c) nothing changed: everything kept, nothing copied, nothing added', async () => {
    seed({ status: 'in_progress' })
    await handIn({ url: FOLDER_URL }); await runJob()
    const n = finalFilesOf(card()).length
    const r1 = reads(CLIP1), r2 = reads(CLIP2)
    await handIn({ url: FOLDER_URL }); await runJob()
    expect(finalFilesOf(card())).toHaveLength(n)
    expect([reads(CLIP1), reads(CLIP2)]).toEqual([r1, r2])
    expect(card().drive_handins[1]).toMatchObject({ status: 'done', file_ids: [] })
  })

  it('a folder only Google’s public view shows (no checksum, no change time): the same clip at the same size is KEPT, a re-export is a new cut (30 Sep 2026: an unchanged 1.9 GB folder was copied again whole)', async () => {
    seed({ status: 'in_progress' })
    h.drive[CLIP1].publicOnly = true; h.drive[CLIP2].publicOnly = true
    await handIn({ url: FOLDER_URL }); await runJob()
    await setCard({ status: 'revision_required', change_note_at: new Date().toISOString() })
    const before2 = reads(CLIP2)
    h.drive[CLIP1].bytes = (h.drive[CLIP1].bytes ?? 0) + 57      // Script 1 re-exported: a new size
    await handIn({ url: FOLDER_URL }); await runJob()
    const hi = card().drive_handins[1]
    expect(hi.carried).toEqual([CLIP2])                           // Script 2 as it was: not copied again
    expect(hi.file_ids).toHaveLength(1)                           // Script 1: its new cut
    expect(reads(CLIP2)).toBe(before2)
    // each cut has its own copy: the earlier one still points at its own bytes
    const urls = finalFilesOf(card()).map(f => f.url)
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('after the CLIENT sends it back: one replaced + one new + one removed → Version 2 is exactly the folder; earlier cuts and their comments stay in Version 1', async () => {
    h.drive[CLIP3] = { name: 'Script 3.mp4', mime: 'video/mp4', bytes: 3000, modified: MOD1, parent: FOLDER, md5: MD5('e') }
    seed({ status: 'in_progress' })
    await handIn({ url: FOLDER_URL }); await runJob()
    const v1 = versionSnapshot(card(), 1)
    expect(v1.map(f => f.name)).toEqual(['Script 1.mp4', 'Script 2.mp4', 'Script 3.mp4'])
    // with the client, who comments on Script 1 and Script 3, then asks for changes
    const comments = [{ video_file_id: v1[0].id }, { video_file_id: v1[2].id }]
    await setCard({ status: 'client_changes_requested', edit_round: 1, client_round: 1, client_rounds: [1], change_note_at: new Date().toISOString() })
    expect(versionLabel(card() as never, handInRound(card() as never))).toBe('Version 2')
    // the folder now: Script 1 re-exported, Script 2 as it was, Script 3 gone, Script 4 new
    h.drive[CLIP1].md5 = MD5('f'); h.drive[CLIP1].modified = MOD2
    delete h.drive[CLIP3]
    h.drive.driveClip00004 = { name: 'Script 4.mp4', mime: 'video/mp4', bytes: 4000, modified: MOD2, parent: FOLDER, md5: MD5('g') }
    await handIn({ url: FOLDER_URL }); await runJob()
    const v2 = versionSnapshot(card(), 2)
    expect(v2.map(f => [f.name, f.version, f.changed, f.new_cut])).toEqual([
      ['Script 1.mp4', 2, true, true],
      ['Script 2.mp4', 1, false, false],
      ['Script 4.mp4', 2, true, false],
    ])
    expect(card().drive_handins[1].retired).toEqual([v1[2].id])
    expect(versionSnapshot(card(), 1).map(f => f.id)).toEqual(v1.map(f => f.id))
    for (const c of comments) expect(versionSnapshot(card(), 1).some(f => f.id === c.video_file_id)).toBe(true)
  })

  it('a single-file link is the whole version: that one file', async () => {
    seed({ status: 'in_progress' })
    await handIn({ url: `https://drive.google.com/file/d/${CLIP2}/view` }); await runJob()
    expect(versionSnapshot(card(), 1).map(f => f.drive_file_id)).toEqual([CLIP2])
  })
})

describe('the card after a send-back (30 Sep 2026, the walk)', () => {
  it('a hand-in made before the send-back no longer says "handed in"; one still copying, or made after, does', async () => {
    const { handInOutdated } = await import('../app/lib/drive-handin-core')
    const h = (requested_at: string, status = 'done') => ({ drive_handins: [{ id: 'h', pull_id: 'p', link: 'l', drive_ids: [], round: 1, by: null, requested_at, status }] })
    expect(handInOutdated({ ...h('2026-09-30T12:50:00Z'), change_note_at: '2026-09-30T13:10:00Z' })).toBe(true)
    expect(handInOutdated({ ...h('2026-09-30T13:20:00Z'), change_note_at: '2026-09-30T13:10:00Z' })).toBe(false)
    expect(handInOutdated({ ...h('2026-09-30T12:50:00Z', 'copying'), change_note_at: '2026-09-30T13:10:00Z' })).toBe(false)
    expect(handInOutdated(h('2026-09-30T12:50:00Z'))).toBe(false)
  })
  it('each earlier version is listed once — its last cut', async () => {
    const { lastCutPerVersion } = await import('../app/lib/drive-handin-core')
    expect(lastCutPerVersion([{ id: 'a', version: 1 }, { id: 'b', version: 1 }, { id: 'c', version: 2 }]).map(x => x.id)).toEqual(['c', 'b'])
  })
  it('the card: no hand-in while the client’s request waits on the manager, no old note, the status line knows', () => {
    const d = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(d).toContain("{mayFile && !frozen && item?.status !== 'client_changes_requested' && (")
    expect(d).toContain("change_note && item?.status !== 'client_changes_requested' && (")
    expect(d).toContain('const earlier = lastCutPerVersion(')
    expect(readFileSync('app/dashboard/board/DriveHandIn.tsx', 'utf8')).toContain('const latest = handInOutdated(item) ? null : latestHandIn(item)')
  })
})

describe('the progress tray clears itself (30 Sep 2026: finished copies stacked over the card)', () => {
  it('a finished copy leaves after a few seconds; a new hand-in on a card replaces its old row', () => {
    const rows = readFileSync('app/dashboard/DriveCopyRows.tsx', 'utf8')
    expect(rows).toContain('const t = setTimeout(() => dismissDriveCopy(watch.handInId), DONE_SHOWN_MS)')
    expect(readFileSync('app/dashboard/driveCopyWatch.ts', 'utf8')).toContain('x.handInId !== w.handInId && x.itemId !== w.itemId')
  })
})

describe('after the client asks for changes, before the manager decides (1 Oct 2026, the walk)', () => {
  it('the files section names the version the client answered, and its old "handed in" line is not shown', async () => {
    const { handInOutdated } = await import('../app/lib/drive-handin-core')
    const { shownRound, handInRound } = await import('../app/lib/edit-round-core')
    const card = { status: 'client_changes_requested', edit_round: 2, client_round: 2, client_rounds: [1, 2],
      drive_handins: [{ id: 'h', pull_id: 'p', link: 'l', drive_ids: [], round: 2, settled_round: 2, by: null, requested_at: '2026-09-30T13:00:00Z', status: 'done' }] }
    expect(handInRound(card)).toBe(3)
    expect(shownRound(card)).toBe(2)
    expect(handInOutdated(card)).toBe(true)
    // the manager sends it back: Version 3 is being made, and the editor's new hand-in line shows once it lands
    expect(shownRound({ ...card, status: 'revision_required' })).toBe(3)
    expect(readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')).toContain('Your finished edit — {roundLabel(shownRound(item as never))}')
  })
})

describe('a Drive hand-in that changed nothing (1 Oct 2026, the walk)', () => {
  it('says so, in amber, and Submit says why it waits', async () => {
    const { handInWords, submitWaitsWords } = await import('../app/lib/drive-handin-core')
    const h = { id: 'h', pull_id: 'p', link: 'l', drive_ids: [], round: 3, settled_round: 3, by: null, requested_at: 'x', status: 'done' as const, file_ids: [], carried: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], new_ids: [] }
    expect(handInWords(null, h, 0)).toEqual({ tone: 'working', words: 'Nothing changed — all 7 files are the same as before. Change them in Google Drive, then hand the link in again.' })
    expect(submitWaitsWords({ drive_handins: [h] })).toBe('Nothing changed — all 7 files are the same as before. Change them in Google Drive, then hand the link in again.')
    expect(submitWaitsWords({ drive_handins: [] })).toBe('Hand in from Google Drive first.')
    // one clip re-exported: a real hand-in, in the usual words
    expect(handInWords(null, { ...h, file_ids: ['x'], carried: ['b', 'c', 'd', 'e', 'f', 'g'] }, 0)?.words).toBe('7 files handed in — 0 new, 1 updated, 6 unchanged')
    const d = readFileSync('app/dashboard/board/EditorCardDrawer.tsx', 'utf8')
    expect(d).not.toContain("'Upload the finished files first'")
  })
})
