import 'server-only'
import { table } from '@/lib/db'
import type { MilanoteMedia } from '@/lib/db-types'
import { putObject } from './storage'
import { MAX_ATTEMPTS, MAX_BYTES, isMilanoteSrc, nextToCopy } from './milanote-media-core'

/**
 * COPYING MILANOTE'S IMAGES AND FILES INTO OUR STORAGE — the server half (20 Oct 2026, docs/MILANOTE_MERGE.md).
 *
 * One batch: take the next rows (milanote-media-core.nextToCopy), CLAIM each (todo → copying, trap 11: two runs
 * never copy one file twice), download it from Milanote — read only — store it in R2 with the live app's keys,
 * and write where it landed. A failure is counted and retried up to three times, then left `failed` with why.
 */
const rows = () => table<MilanoteMedia>('milanote_media')

export async function copyMilanoteBatch(limit = 6): Promise<{ copied: number; failed: number; tried: number }> {
  const all = await rows().list({ fresh: true })
  const now = Date.now()
  const picks = nextToCopy(all as never as (MilanoteMedia & { attempts: number })[], now, limit)
  let copied = 0, failed = 0
  for (const pick of picks) {
    const claim = await rows().claim(pick.id, cur => (cur && (cur.status === 'todo' || cur.status === 'copying') && cur.updated_at === pick.updated_at
      ? { ...cur, status: 'copying', updated_at: new Date().toISOString() } : null))
    if (!claim.claimed) continue
    const row = claim.row
    try {
      if (!isMilanoteSrc(row.src)) throw new Error('Not a Milanote link')
      const res = await fetch(row.src, { redirect: 'follow' })
      if (!res.ok) throw new Error(`Milanote answered ${res.status}`)
      const length = Number(res.headers.get('content-length') ?? 0)
      if (length > MAX_BYTES) throw new Error(`Too big (${Math.round(length / 1048576)} MB)`)
      const bytes = Buffer.from(await res.arrayBuffer())
      if (bytes.length > MAX_BYTES) throw new Error('Too big')
      const mime = row.mime || res.headers.get('content-type') || 'application/octet-stream'
      const { publicUrl } = await putObject(`milanote-${row.name}`, bytes, mime)
      await rows().update(row.id, { status: 'done', url: publicUrl, mime, size: bytes.length, error: null, updated_at: new Date().toISOString() } as never)
      copied++
    } catch (e) {
      const attempts = Number(row.attempts ?? 0) + 1
      await rows().update(row.id, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'todo', attempts,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 300), updated_at: new Date().toISOString(),
      } as never)
      failed++
    }
  }
  return { copied, failed, tried: picks.length }
}
