import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DriveSeen, DriveSource } from '@/lib/db-types'
import { driveLinkTarget, driveHandInsOf } from './drive-handin-core'
import { readDriveTarget } from './drive-pull'
import { finalFilesOf, assetIdOf } from './final-files-core'
import {
  WATCHED_STATUSES, firstState, seenId, sourceId, unseen,
  type CardFile, type SeenFile,
} from './drive-scan-core'

/**
 * THE EDITOR PREVIEW'S DRIVE INBOX — the server half (drive-scan-core.ts has the rules and the why).
 *
 *   sources — every link a card was given: the links of its Drive hand-ins, and any added on the preview's card page;
 *   watch   — each source read again (READ ONLY, trap 13), each file not yet seen at its content recorded once in
 *             `drive_seen` with what Drive says of it. It writes these two tables and nothing else: never a card.
 *
 * Run every minute by the `drive-scan-watch` job when DRIVE_SCAN=1.
 */

export function cardFilesOf(item: { final_files?: unknown }): CardFile[] {
  return finalFilesOf(item as never).map(f => ({
    id: f.id, asset: assetIdOf(f), name: f.name, drive_file_id: f.drive_file_id ?? null, drive_md5: f.drive_md5 ?? null, version: f.version,
  }))
}

/** one source for a link on a card — made once (claimed), kept */
export async function ensureSource(item: { id: string; status?: unknown }, link: string, by: string | null): Promise<DriveSource | null> {
  const target = driveLinkTarget(link)
  if (!target.ok) return null
  const id = sourceId(item.id, target.id)
  const now = new Date().toISOString()
  const put = await table<DriveSource>('drive_sources').claim(id, cur => cur ? null : {
    id, item_id: item.id, link: target.url, drive_id: target.id, kind: target.kind, added_by: by,
    stage_at_add: String(item.status ?? ''), last_checked_at: null, last_error: null, file_count: null, created_at: now, updated_at: now,
  } as DriveSource)
  return put.claimed ? put.row : (put.current as DriveSource | null)
}

/** every card being made, with the links of its Drive hand-ins as sources (the first run seeds them) */
async function seedSources(items: readonly ContentItem[]): Promise<void> {
  const have = new Set((await table<DriveSource>('drive_sources').list({ fresh: true })).map(s => s.id))
  for (const i of items) {
    for (const h of driveHandInsOf(i as never)) {
      const t = driveLinkTarget(h.link)
      if (!t.ok || have.has(sourceId(i.id, t.id))) continue
      await ensureSource(i, h.link, h.by ?? null).catch(() => null)
      have.add(sourceId(i.id, t.id))
    }
  }
}

export type WatchResult = { sources: number; read: number; seen: number; toScan: string[]; errors: number }

/**
 * ONE MINUTE'S CHECK. Each source of a card being made is read; each file not yet seen at its content gets one row,
 * in the state the card and its stage give it (drive-scan-core.firstState). The rows that need the AI are returned.
 */
export async function watchSources(opts: { limit?: number } = {}): Promise<WatchResult> {
  const items = await table<ContentItem>('content_items').list({ where: r => WATCHED_STATUSES.includes(String(r.status ?? '')), fresh: true })
  await seedSources(items)
  const byId = new Map(items.map(i => [i.id, i]))
  const sources = (await table<DriveSource>('drive_sources').list({ fresh: true })).filter(s => byId.has(s.item_id)).slice(0, opts.limit ?? 60)
  const seenTable = table<DriveSeen>('drive_seen')
  const seenIds = new Set((await seenTable.list({ fresh: true })).map(r => r.id))
  const out: WatchResult = { sources: sources.length, read: 0, seen: 0, toScan: [], errors: 0 }
  for (const s of sources) {
    const item = byId.get(s.item_id)!
    const now = new Date().toISOString()
    try {
      const files = await readDriveTarget(s.kind === 'file' ? 'file' : 'folder', s.drive_id, { cuts: true }) as SeenFile[]
      out.read++
      const fresh = unseen(item.id, files, seenIds)
      const cardFiles = cardFilesOf(item)
      for (const f of fresh) {
        const id = seenId(item.id, f)
        const state = firstState(f, cardFiles, item.status)
        const put = await seenTable.claim(id, cur => cur ? null : {
          id, item_id: item.id, source_id: s.id, drive_file_id: f.id, path: f.name, name: f.name.slice(f.name.lastIndexOf('/') + 1),
          mime: f.mime, size: f.size ?? null, md5: f.md5 ?? null, revision: f.revision ?? null, modified: f.modified ?? null,
          created_time: f.created ?? null, last_modifying_user: f.lastModifier ?? null, duration_ms: f.durationMs ?? null,
          width: f.width ?? null, height: f.height ?? null, stage_at_seen: String(item.status ?? ''), state, scan: null,
          decided_by: null, decided_at: null, first_seen_at: now, created_at: now, updated_at: now,
        } as DriveSeen)
        seenIds.add(id)
        if (!put.claimed) continue
        out.seen++
        if (state === 'new' || state === 'locked') out.toScan.push(id)
      }
      await table<DriveSource>('drive_sources').update(s.id, { last_checked_at: now, last_error: files.length ? null : 'Nothing readable in this link — is it shared with the agency’s Drive?', file_count: files.length } as never)
    } catch (e) {
      out.errors++
      await table<DriveSource>('drive_sources').update(s.id, { last_checked_at: now, last_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } as never).catch(() => undefined)
    }
  }
  return out
}

