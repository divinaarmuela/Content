import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PART_BYTES, canStartPull, filesOf, formatBytes, formatLeft, nextSlice, pullId, pullLooksStuck, pullObjectKey, pullProgress,
} from '../app/lib/drive-pull-core'

/**
 * A DRIVE FOLDER, PULLED INTO OUR OWN STORAGE (the owner, 16 Sep 2026: "I
 * want a Drive link to be uploaded and it downloads it — a proper loading
 * feature so we know how long it would take"; "have Inngest download it";
 * "version 1, 2 or 3 will have different files but the same Drive link").
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const T0 = Date.parse('2026-09-16T01:00:00Z')

describe('the slices, the keys and the words (pure)', () => {
  it('one row per folder; a slice is the next 128 MB of a file, and none once it is all here', () => {
    expect(pullId('1abc')).toBe('folder-1abc')
    expect(nextSlice({ size: 300 * 1024 * 1024, done: 0 })).toEqual({ start: 0, end: PART_BYTES - 1, n: 1 })
    expect(nextSlice({ size: 300 * 1024 * 1024, done: PART_BYTES })).toEqual({ start: PART_BYTES, end: 2 * PART_BYTES - 1, n: 2 })
    expect(nextSlice({ size: 300 * 1024 * 1024, done: 2 * PART_BYTES })).toEqual({ start: 2 * PART_BYTES, end: 300 * 1024 * 1024 - 1, n: 3 })
    expect(nextSlice({ size: 300 * 1024 * 1024, done: 300 * 1024 * 1024 })).toBeNull()
    expect(nextSlice({ size: null, done: 0 })).toBeNull()
  })
  it('a copy lands under the folder, named by the file, safe in a URL', () => {
    expect(pullObjectKey('1abc', { id: 'f1', name: 'Script 3 (final).mov' })).toBe('pulls/1abc/f1-Script_3__final_.mov')
  })
  it('bytes and time, in a person’s words', () => {
    expect(formatBytes(0)).toBe('0 MB')
    expect(formatBytes(512 * 1024)).toBe('512 KB')
    expect(formatBytes(346828594)).toBe('331 MB')
    expect(formatBytes(18.4 * 1024 ** 3)).toBe('18 GB')
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB')
    expect(formatLeft(20)).toBe('under a minute left')
    expect(formatLeft(70)).toBe('about a minute left')
    expect(formatLeft(9 * 60)).toBe('about 9 min left')
    expect(formatLeft(2 * 3600 + 5 * 60)).toBe('about 2 h 5 min left')
    expect(formatLeft(null)).toBeNull()
  })
  it('the bar: the bytes done, the rate since it started, and the time left', () => {
    const row = {
      id: 'folder-1', folder_id: '1', folder_url: 'u', kind: 'batch', scope_id: 'b', status: 'copying',
      total_files: 4, total_bytes: 4 * 1024 ** 3, done_files: 1, done_bytes: 1024 ** 3,
      started_at: new Date(T0 - 60_000).toISOString(),
    }
    const p = pullProgress(row, T0)!
    expect(p.pct).toBe(25)
    expect(p.rate).toBeCloseTo(1024 ** 3 / 60, -3)
    expect(Math.round(p.left!)).toBe(180)
    expect(p.words).toBe('1 of 4 files · 1.0 GB of 4.0 GB · about 3 min left')
    expect(pullProgress({ ...row, status: 'queued' }, T0)!.words).toBe('Waiting to start…')
    expect(pullProgress({ ...row, status: 'listing' }, T0)!.words).toBe('Reading the folder…')
    expect(pullProgress({ ...row, status: 'done', done_bytes: row.total_bytes, done_files: 4 }, T0)!.words).toBe('All 4 files are here · 4.0 GB')
    expect(pullProgress({ ...row, status: 'unreadable', error: 'The folder could not be read' }, T0)!.words).toBe('The folder could not be read')
    expect(pullProgress({ ...row, status: 'failed', error: '1 file could not be copied' }, T0)!.words).toBe('Stopped: 1 file could not be copied')
    expect(pullProgress({ ...row, status: 'copying', done_bytes: 0, started_at: null }, T0)!.words).toBe('1 of 4 files · 0 MB of 4.0 GB · working out the time left…')
    expect(pullProgress(null, T0)).toBeNull()
  })
  it('a pull may start when there is none, after a failure, or when an in-flight one has not moved for twenty minutes', () => {
    const base = { id: 'x', folder_id: '1', folder_url: 'u', kind: 'item', scope_id: 'i', total_files: 0, total_bytes: 0, done_files: 0, done_bytes: 0 }
    expect(canStartPull(null)).toBe(true)
    expect(canStartPull({ ...base, status: 'failed' })).toBe(true)
    expect(canStartPull({ ...base, status: 'unreadable' })).toBe(true)
    expect(canStartPull({ ...base, status: 'copying' })).toBe(false)
    expect(pullLooksStuck({ ...base, status: 'copying', updated_at: new Date(T0 - 5 * 60_000).toISOString() }, T0)).toBe(false)
    expect(pullLooksStuck({ ...base, status: 'copying', updated_at: new Date(T0 - 25 * 60_000).toISOString() }, T0)).toBe(true)
    expect(pullLooksStuck({ ...base, status: 'done', updated_at: new Date(T0 - 25 * 60_000).toISOString() }, T0)).toBe(false)
  })
  it('only well-formed files are read off a row', () => {
    expect(filesOf({ files: [{ id: 'a', name: 'a.mov', mime: 'video/quicktime', size: 1, done: 0, url: null, status: 'waiting' }, null, 'junk', { name: 'no id' }] })).toHaveLength(1)
    expect(filesOf(null)).toEqual([])
  })
})

describe('the job, the triggers and the pages (source pins)', () => {
  it('the job is registered, lists once, then moves slices file by file until each is done, then settles the row', () => {
    const s = src('app/inngest/functions.ts')
    expect(s).toContain("id: 'drive-pull-folder'")
    expect(s).toContain("triggers: [{ event: 'drive/pull.folder' }]")
    expect(s).toContain("concurrency: { limit: 1, key: 'event.data.pull_id' }")
    expect(s).toContain("await step.run('list', async () => {")
    expect(s).toContain('const r = await step.run(`copy:${fileId}:${n}`, async () => {')
    expect(s).toContain("return step.run('finish', async () => {")
    expect(s).toMatch(/export const functions = \[[\s\S]*drivePullFolder,[\s\S]*\]/)
  })
  it('the server half reads Drive and writes only to R2 — never a Drive write', () => {
    const s = src('app/lib/drive-pull.ts')
    expect(s).toContain("export const PULL_EVENT = 'drive/pull.folder'")
    expect(s).toContain("await openDriveFile(file.id, `bytes=${slice.start}-${slice.end}`, ctrl.signal)")
    expect(s).toContain('await putMultipartPart(key, file.upload_id!, slice.n, bytes)')
    expect(s).not.toMatch(/googleapis\.com\/upload|method: '(POST|PATCH|PUT|DELETE)'/)
    // a file already here with the same size stands; a new cut in the same folder is new files
    expect(s).toContain("if (had && had.status === 'done' && had.url && had.size === f.size) return { ...had, name: f.name }")
    // a finished pull asks for a preview of each video copy up to 800 MB (16 Sep 2026)
    expect(s).toContain("previewVideos(files.filter(f => f.status === 'done' && !!f.url && fileKindOf(f.mime, f.name) === 'video' && (f.size ?? 0) <= PREVIEW_MAX_BYTES).map(f => f.url))")
    expect(s).toContain('const PREVIEW_MAX_BYTES = 800 * 1024 * 1024')
    expect(s).toContain('version: version ?? null')
    const st = src('app/lib/storage.ts')
    for (const fn of ['openMultipart', 'putMultipartPart', 'closeMultipart', 'abortMultipart']) expect(st).toContain(`export async function ${fn}(`)
  })
  it('a link replaced while its files were still coming calls that pull off; every step of the job reads the mark and stops (16 Sep 2026)', async () => {
    const { pullInFlight, PULL_REPLACED_WORDS, pullProgress } = await import('../app/lib/drive-pull-core')
    expect(pullInFlight({ status: 'copying' } as never)).toBe(true)
    expect(pullInFlight({ status: 'done' } as never)).toBe(false)
    expect(pullProgress({ status: 'failed', error: PULL_REPLACED_WORDS, total_files: 3, total_bytes: 10, done_files: 1, done_bytes: 4 } as never, 0)?.words).toBe(`Stopped: ${PULL_REPLACED_WORDS}`)
    const s = src('app/lib/drive-pull.ts')
    expect(s).toContain('export async function cancelReplacedPull(')
    // only this shoot’s or card’s pull, only while it is running, never the same folder spelled differently
    expect(s).toContain('if (next && next.id === old.id) return false')
    expect(s).toContain("if (!row || row.kind !== opts.kind || row.scope_id !== opts.scopeId || !pullInFlight(row as never)) return null")
    expect(s).toContain("status: 'failed', error: PULL_REPLACED_WORDS, cancelled_at: now, finished_at: now, updated_at: now,")
    // the open uploads are abandoned, and a fresh start clears the mark
    expect(s).toContain('await abortMultipart(pullObjectKey(old.id, f), f.upload_id).catch(() => undefined)')
    expect(s).toContain('cancelled_at: null,')
    // list, slices (between slices too) and finish all stop on the mark
    expect(s).toContain("if ((row as { cancelled_at?: string | null }).cancelled_at) return { files: 0, bytes: 0, note: 'cancelled' }")
    expect(s).toContain('if ((row as { cancelled_at?: string | null }).cancelled_at) return { done: true, cancelled: true }')
    expect(s).toContain('if (fresh?.cancelled_at) {')
    expect(s).toContain("if ((row as { cancelled_at?: string | null }).cancelled_at) return 'failed'")
    expect(src('app/inngest/functions.ts')).toContain('if (r.cancelled) return { cancelled: true }')
    // the three places a link is replaced
    expect(src('app/api/production/batches/[id]/route.ts')).toContain("if (footageReplaced) cancelReplacedPullSoon({ kind: 'batch', scopeId: data.id, oldUrl: oldFootage, newUrl: patch.footage_url ? String(patch.footage_url) : null })")
    expect(src('app/api/production/batches/[id]/route.ts')).toContain('try { await replaceFootageFolder(user as never, data, oldFootage) }')
    expect(src('app/api/production/items/[id]/route.ts')).toContain("cancelReplacedPullSoon({ kind: 'item', scopeId: id, oldUrl: (current as { raw_assets_url?: string | null }).raw_assets_url ?? null")
    expect(src('app/api/production/items/[id]/link/route.ts')).toContain("if (done.replaced) cancelReplacedPullSoon({ kind: 'item', scopeId: id, oldUrl: item.link_url ?? null, newUrl: check.url })")
  })
  it('saving a folder anywhere starts its pull, after the response', () => {
    expect(src('app/api/production/batches/[id]/route.ts')).toContain("if ('footage_url' in patch && patch.footage_url) startPullSoon({ kind: 'batch', scopeId: data.id, folderUrl: String(patch.footage_url), by: user.id, purpose: 'folder' })")
    expect(src('app/api/production/items/[id]/route.ts')).toContain("startPullSoon({ kind: 'item', scopeId: id, folderUrl: patch.raw_assets_url, version: 1, by: user.id, purpose: 'folder' })")
    // …and a folder pasted on the New card window, the moment the card is made (16 Sep 2026)
    expect(src('app/api/production/items/route.ts')).toContain("if (item.raw_assets_url) startPullSoon({ kind: 'item', scopeId: item.id, folderUrl: String(item.raw_assets_url), version: 1, by: user.id, purpose: 'folder' })")
    expect(src('app/api/production/items/[id]/link/route.ts')).toContain("if (check.kind === 'drive') startPullSoon({ kind: 'item', scopeId: id, folderUrl: check.url, version: final ? handInRound(item) : 1, by: user.id, purpose: final ? 'finished' : 'folder' })")
    const route = src('app/api/drive/pull/route.ts')
    expect(route).toContain("const user = await requireRole('scheduler')")
    expect(route).toContain('await canManageBatch(user, batch)')
    expect(route).toContain("h === 'editor' || h === 'account_manager' || h === 'super_admin' || h === 'scheduler'")
  })
  it('the bar sits under the folder on the shoot page and the card; the editing portal plays our copies once they are here', () => {
    expect(src('app/dashboard/production/shoots/[id]/ShootSop.tsx')).toContain('<DrivePullBar kind="batch" scopeId={batch.id} folderUrl={batch.footage_url} mayStart />')
    const box = src('app/dashboard/board/FilesToWorkFrom.tsx')
    expect(box).toContain('<DrivePullBar kind={pullScope.kind} scopeId={pullScope.id} folderUrl={folder} mayStart={mayEdit && !!pullScope.id} showFiles={false} onPulled={files => setPulled(files)} />')
    // the tiles open like before, from our copies, with a pill per version (16 Sep 2026)
    expect(box).toContain('copies={pulled} />')
    const tiles = src('app/dashboard/board/DriveFolderFiles.tsx')
    expect(tiles).toContain('const tiles = fromCopies ? copyTiles : state.at === \'ready\' ? state.tiles : []')
    expect(tiles).toContain('<video key={showing.id} src={showing.preview} controls playsInline preload="metadata"')
    expect(tiles).toContain("{roundLabel(r)}{r === rounds[0] ? ' · latest' : ''}")
    // the hover shows the preview's stills once it is ready; the copy itself before
    expect(tiles).toContain('const previews = usePreviewRows(')
    expect(tiles).toContain('frames={previewOf(t) ? (s => streamThumbnailUrl(previewOf(t), { time: `${s}s`, height: 480 }) as string) : null}')
    const hover = src('app/components/media/HoverClip.tsx')
    expect(hover).toContain("const stills = !!frames && !!poster && typeof duration === 'number' && duration > 0")
    const bar = src('app/dashboard/board/DrivePullBar.tsx')
    expect(bar).toContain("useRow<DrivePull>('drive_pulls', folderId ? pullId(folderId) : null)")
    expect(bar).toContain('role="progressbar"')
    expect(bar).toContain("fetch('/api/drive/pull'")
    const portal = src('app/lib/editing-portal.ts')
    expect(portal).toContain("const pulled = filesOf(pull).filter(f => f.status === 'done' && !!f.url && kindOf(f.mime, f.name) === 'video')")
  })
})
