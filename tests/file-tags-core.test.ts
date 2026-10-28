import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { chipsOf, cleanTag, postedFiles, tagsOfAsset, tagsOnCard, withAssetTag, wentOut } from '../app/lib/file-tags-core'
import { sanitiseFinalFiles } from '../app/lib/final-files-core'

// the owner, 28 Oct 2026: "allow to add a tag in the editor files anytime … if the file has been posted through our
// app it marks as posted automatically"
const v1 = { id: 'f1', name: 'Justin 6.mov', url: 'https://r2.dev/a-Justin_6.mov', mime: 'video/quicktime', size: 434034932, version: 1, uploaded_at: '2026-10-01T00:00:00Z', drive_file_id: '1eLBaddLmEhHkt8zSzy59QNmIrYnTwd6Q' }
const v2 = { ...v1, id: 'f2', url: 'https://r2.dev/b-Justin_6.mov', version: 2, asset_id: 'f1', uploaded_at: '2026-10-05T00:00:00Z', drive_file_id: undefined, size: 500 }
const other = { id: 'g1', name: 'Justin 3.mov', url: 'https://r2.dev/Justin_3.mov', mime: 'video/quicktime', size: 1000, version: 1, uploaded_at: '2026-10-01T00:00:00Z' }

describe('a person’s tags', () => {
  it('are tidied and never empty', () => {
    expect(cleanTag('  hook   test ')).toBe('hook test')
    expect(cleanTag('   ')).toBeNull()
    expect(cleanTag('x'.repeat(50))).toHaveLength(30)
  })
  it('belong to the video: on every version, kept by the next one, one of each whatever the case', () => {
    let files = withAssetTag([v1, v2, other] as never, 'f1', 'Ad', true)
    files = withAssetTag(files, 'f1', 'ad', true)
    expect(files.find(f => f.id === 'f1')?.tags).toEqual(['Ad'])
    expect(files.find(f => f.id === 'f2')?.tags).toEqual(['Ad'])
    expect(files.find(f => f.id === 'g1')?.tags).toBeUndefined()
    expect(tagsOfAsset({ final_files: [...files, { ...v1, id: 'f3', version: 3, asset_id: 'f1', url: 'https://r2.dev/c.mov' }] }, 'f1')).toEqual(['Ad'])
    expect(tagsOnCard({ final_files: files })).toEqual(['Ad'])
    files = withAssetTag(files, 'f1', 'AD', false)
    expect(tagsOfAsset({ final_files: files }, 'f1')).toEqual([])
  })
  it('survive every later save of the card’s files', () => {
    const r = sanitiseFinalFiles([{ ...other, tags: ['Ad', '  Hook  '] }], { edit_round: 1, status: 'draft_uploaded' }, null, '2026-10-28T00:00:00Z')
    expect(r.ok && r.files[0].tags).toEqual(['Ad', 'Hook'])
  })
})

describe('Posted, by itself', () => {
  const booked = { id: 'p0', stage: 'booked', slides: [{ url: other.url }] }
  it('only a post that went out — not one booked, not one cancelled', () => {
    expect(wentOut({ id: 'a', stage: 'posted' })).toBe(true)
    expect(wentOut({ id: 'a', status: 'published' })).toBe(true)
    expect(wentOut(booked)).toBe(false)
    expect(wentOut({ id: 'a', stage: 'cancelled', status: 'published' })).toBe(false)
  })
  it('the same file, the same Drive file, or the same name and size uploaded again', () => {
    const item = { final_files: [v1, v2, other] }
    const byDrive = postedFiles(item, [{ id: 'p1', stage: 'posted', scheduled_for: '2026-10-02T08:00:00Z', slides: [{ drive_file_id: v1.drive_file_id, url: 'https://elsewhere/x.mov' }] }])
    expect([...byDrive.keys()]).toEqual(['f1'])
    const reUpload = postedFiles(item, [{ id: 'p2', stage: 'posted', slides: [{ name: 'Justin 3.mov', bytes: 1000, url: 'https://r2.dev/again.mov' }] }, booked])
    expect([...reUpload.keys()]).toEqual(['g1'])
    expect(postedFiles(item, [{ id: 'p3', stage: 'posted', slides: [{ name: 'Justin 3.mov', bytes: 999 }] }]).size).toBe(0)
  })
  it('on the chips: first, not removable, and an earlier cut says so', () => {
    const item = { final_files: withAssetTag([v1, v2, other] as never, 'f1', 'Posted', true).concat() }
    const posted = postedFiles({ final_files: [v1, v2] }, [{ id: 'p1', stage: 'posted', slides: [{ url: v1.url }] }])
    expect(chipsOf(item, 'f1', 'f2', posted)).toEqual([{ tag: 'Posted', auto: true, older: true }])
    expect(chipsOf(item, 'f1', 'f1', posted)).toEqual([{ tag: 'Posted', auto: true }])
    // nothing posted: a person's own "Posted" (a post made outside the app) is theirs to take off
    expect(chipsOf({ final_files: withAssetTag([other] as never, 'g1', 'Ad', true).map(f => ({ ...f, tags: ['Ad', 'Posted'] })) }, 'g1', 'g1', new Map())).toEqual([{ tag: 'Ad', auto: false }, { tag: 'Posted', auto: false }])
  })
})

describe('the card page and the route', () => {
  it('every video tile carries its tags, and the route claims the card', () => {
    const page = readFileSync('app/dashboard/editor/[id]/page.tsx', 'utf8')
    expect(page).toContain('<FileTags item={item} fileId={info(s).file!.id}')
    // the badges that come by themselves are on the picture; the tags under the name are a person's only
    expect(page).toContain('<StatusBadges graded={!!s.latest.graded}')
    expect(page).toContain('chips.filter(c => !c.auto).map(c => (')
    expect(page).toContain("useTable<PostLike & { client_id?: string }>('social_posts'")
    const route = readFileSync('app/api/production/items/[id]/file-tags/route.ts', 'utf8')
    expect(route).toContain(".claim(id, cur =>")
    expect(route).toContain("requireRole('scheduler')")
  })
})

describe('Scheduled, by itself', () => {
  it('a cut booked in a post that has not gone shows Scheduled with its time, and turns to Posted when it goes', async () => {
    const { scheduledFiles, chipsOf, postedFiles } = await import('../app/lib/file-tags-core')
    const item = { final_files: [other] }
    const booked = { id: 'b1', stage: 'booked', scheduled_for: '2026-11-07T03:30:00.000Z', slides: [{ url: other.url }] }
    const s = scheduledFiles(item, [booked, { ...booked, id: 'c1', cancelled: true }])
    expect([...s.keys()]).toEqual(['g1'])
    expect(chipsOf(item, 'g1', 'g1', new Map(), s)).toEqual([{ tag: 'Scheduled', auto: true, at: '2026-11-07T03:30:00.000Z' }])
    const gone = [{ ...booked, stage: 'posted' }]
    expect(scheduledFiles(item, gone).size).toBe(0)
    expect(chipsOf(item, 'g1', 'g1', postedFiles(item, gone), scheduledFiles(item, gone))).toEqual([{ tag: 'Posted', auto: true }])
  })
})

describe('the same video downloaded again', () => {
  it('"Video 03 (1).mp4" of the same size is the card’s "Video 03.mp4"; another size is not', async () => {
    const { slideIsFile, plainName } = await import('../app/lib/file-tags-core')
    const f = { url: 'https://r2.dev/Video_03.mp4', name: 'Video 03.mp4', size: 143092889 }
    expect(plainName('Video 06 (4).mp4')).toBe('video 06.mp4')
    expect(slideIsFile({ name: 'Video 03 (1).mp4', bytes: 143092889, url: 'https://x/y.mp4' }, f)).toBe(true)
    expect(slideIsFile({ name: 'Video 03 (1).mp4', bytes: 1, url: 'https://x/y.mp4' }, f)).toBe(false)
    expect(slideIsFile({ name: 'Video 3.mp4', bytes: 143092889, url: 'https://x/y.mp4' }, f)).toBe(false)
  })
})
