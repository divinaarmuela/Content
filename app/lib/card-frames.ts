import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, VideoFrame } from '@/lib/db-types'
import { currentFiles } from './final-files-core'
import { isVideo } from './drive-scan-core'
import { framesRowId, makeStoryboard, probeVideo } from './scan-measure'

/**
 * EVERY VIDEO ON A CARD GETS ITS PICTURES, ONCE (the owner, 25 Oct 2026: "make those pictures every hover is quick and
 * instant once its uploaded"). The frames and the storyboard the old AI scan made — ffmpeg only, no AI — taken from
 * our own stored copy (never Drive: reading Drive files over and over gets them blocked). Asked for the moment a file
 * lands on a card (drive-handin settle), and a sweep picks up anything missed, older cards included.
 *
 * A video ffmpeg cannot read is marked in claim_locks (`frames_failed__{row}`) and left a day before it is tried again.
 */
const failKey = (rowId: string) => `frames_failed__${rowId}`

/** measure one video and make its storyboard — the job's one step each */
export async function measureCardVideo(url: string): Promise<{ ok: boolean; note: string }> {
  const key = `r2:${url}`
  const probe = await probeVideo(url, key)
  if (!probe.durationMs) {
    await table('claim_locks').claim(failKey(framesRowId(key)), () => ({ id: failKey(framesRowId(key)), at: new Date().toISOString(), error: String(probe.error ?? 'unreadable').slice(0, 200) })).catch(() => undefined)
    return { ok: false, note: probe.error ?? 'unreadable' }
  }
  // measured but no picture saved (storage refused): not kept, so the next sweep makes them properly
  if (!probe.samples.some(s => s.url)) {
    await table<VideoFrame>('video_frames').remove(framesRowId(key)).catch(() => undefined)
    return { ok: false, note: 'the pictures could not be saved' }
  }
  return { ok: true, note: `${probe.samples.length} frames` }
}

export async function storyboardCardVideo(url: string): Promise<{ ok: boolean; note: string }> {
  return makeStoryboard(`r2:${url}`)
}

/** the card videos with no pictures yet, newest first — every live card, the files on it now */
export async function framesDue(limit: number): Promise<string[]> {
  const cards = await table<ContentItem>('content_items').list({ where: c => !(c as { archived_at?: string | null }).archived_at && c.status !== 'published' })
  const files = cards.flatMap(c => currentFiles(c as never))
    .filter(f => isVideo({ mime: f.mime, name: f.name }) && /^https:\/\//.test(f.url))
    .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
  const have = new Set((await table<VideoFrame>('video_frames').list()).filter(r => r.duration_ms).map(r => r.id))
  const dayAgo = Date.now() - 864e5
  const failed = new Set((await table<{ id: string; at?: string }>('claim_locks').list({ where: r => String(r.id).startsWith('frames_failed__') }))
    .filter(r => Date.parse(String(r.at ?? '')) > dayAgo).map(r => String(r.id)))
  const out: string[] = []
  for (const f of files) {
    const id = framesRowId(`r2:${f.url}`)
    if (have.has(id) || failed.has(failKey(id)) || out.includes(f.url)) continue
    out.push(f.url)
    if (out.length >= limit) break
  }
  return out
}
