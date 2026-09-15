import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  activeCommentId, commentsOnClip, formatStamp, markersFor, parseStamp, reviewPath,
} from '../app/lib/video-review-core'

/**
 * A CLIP'S OWN REVIEW PAGE (the owner, 15 Sep 2026: "the video on the left
 * and the comments on the right — comments mention the timestamp, and on the
 * video there is a highlight circle at that timestamp").
 */
describe('stamps', () => {
  it('reads the way an editor says a time', () => {
    expect(formatStamp(0)).toBe('0:00')
    expect(formatStamp(83)).toBe('1:23')
    expect(formatStamp(725)).toBe('12:05')
    expect(formatStamp(3727)).toBe('1:02:07')
    expect(formatStamp(null)).toBe('0:00')
    expect(formatStamp(83.9)).toBe('1:23')
  })
  it('and back again', () => {
    expect(parseStamp('1:23')).toBe(83)
    expect(parseStamp('12')).toBe(12)
    expect(parseStamp('1:02:07')).toBe(3727)
    expect(parseStamp('nope')).toBeNull()
    expect(parseStamp('1:2:3:4')).toBeNull()
  })
})

const on = (id: string, at: number | null, file = 'f1', created = '2026-09-15T00:00:00Z') =>
  ({ id, body: id, video_timestamp_sec: at, video_file_id: file, created_at: created })

describe('the comments on a clip', () => {
  it('only this clip’s, top-level, oldest stamp first, then oldest written', () => {
    const rows = [on('b', 30), on('a', 5), on('other', 5, 'f2'), { ...on('reply', 5), parent_id: 'a' }, on('nostamp', null, 'f1', '2026-09-15T01:00:00Z')]
    expect(commentsOnClip(rows, 'f1').map(c => c.id)).toEqual(['a', 'b', 'nostamp'])
  })
  it('a marker per stamped comment, placed by the clip’s length; a stamp past the end sits at the end', () => {
    expect(markersFor([on('a', 30), on('n', null), on('late', 500)], 100)).toEqual([
      { id: 'a', at: 30, left: 30, stamp: '0:30' },
      { id: 'late', at: 100, left: 100, stamp: '1:40' },
    ])
    expect(markersFor([on('a', 30)], 0)).toEqual([])
  })
  it('the comment the playhead is on lights up as the clip reaches it, and goes out after a moment', () => {
    const rows = [on('a', 10), on('b', 20)]
    expect(activeCommentId(rows, 9)).toBeNull()
    expect(activeCommentId(rows, 10)).toBe('a')
    expect(activeCommentId(rows, 11)).toBe('a')
    expect(activeCommentId(rows, 13)).toBeNull()
    expect(activeCommentId(rows, 20.5)).toBe('b')
  })
  it('the clip’s page address carries the card, the file and its name', () => {
    expect(reviewPath('item-1', 'abc', 'Script 3.mov')).toBe('/dashboard/editor/item-1/video/abc?name=Script%203.mov')
    expect(reviewPath('item-1', 'abc')).toBe('/dashboard/editor/item-1/video/abc')
  })
})

describe('the page, the stream and the tiles (source pins)', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
  it('the clip streams through a read-only route that passes Range through, so it seeks', () => {
    const s = src('app/api/drive/stream/route.ts')
    expect(s).toContain('export async function GET(')
    expect(s).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)\(/)
    expect(s).toContain("const range = req.headers.get('range')")
    expect(s).toContain("...(range ? { Range: range } : {})")
    expect(s).toContain("headers.set(h, v)")
  })
  it('a press on a clip on the card page opens its review page; a comment says which clip it is on', () => {
    expect(src('app/dashboard/editor/[id]/page.tsx')).toContain('reviewHref={t => reviewPath(id, t.id, t.name)}')
    expect(src('app/dashboard/board/DriveFolderFiles.tsx')).toContain("if (reviewHref && t.kind === 'video') { window.location.assign(reviewHref(t)); return }")
    const c = src('app/api/production/items/[id]/comments/route.ts')
    expect(c).toContain('video_file_id: videoFile,')
    expect(c).toContain('video_file_name: videoName,')
    expect(src('lib/db-types.ts')).toMatch(/export interface ItemComment \{[\s\S]*?video_file_id: string \| null/)
  })
  it('the page draws the clip, the markers and the comments, and stamps the current second', () => {
    const p = src('app/dashboard/editor/[id]/video/[fileId]/page.tsx')
    expect(p).toContain('src={`/api/drive/stream?id=${encodeURIComponent(fileId)}`}')
    expect(p).toContain('aria-label={`Comment at ${m.stamp}`}')
    expect(p).toContain("const at = stamp ? Math.floor(video.current?.currentTime ?? 0) : null")
    expect(p).toContain('<PageTitle')
  })
})
