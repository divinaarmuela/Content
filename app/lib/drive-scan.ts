import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DriveSeen, DriveSource, WorkKind } from '@/lib/db-types'
import { isEditorCard } from './editor-preview-core'
import { driveLinkTarget, driveHandInsOf } from './drive-handin-core'
import { readDriveTarget } from './drive-pull'
import { finalFilesOf, assetIdOf } from './final-files-core'
import {
  WATCHED_STATUSES, cardLinksOf, firstState, seenId, sourceId, unseen,
  type CardFile, type SeenFile,
} from './drive-scan-core'

/**
 * THE EDITOR PREVIEW'S DRIVE INBOX — the server half (drive-scan-core.ts has the rules and the why).
 *
 *   sources — every link a card was given: the links of its Drive hand-ins, and any added on the preview's card page;
 *   watch   — each source read again (READ ONLY, trap 13), each file not yet seen at its content recorded once in
 *             `drive_seen` with what Drive says of it. It writes these two tables and nothing else: never a card.
 *
 * Run every minute by the `drive-scan-watch` job (DRIVE_SCAN=0 stops it).
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

/** every card being made, with its Drive links as sources (drive-scan-core.cardLinksOf; the first run seeds them) */
async function seedSources(items: readonly ContentItem[]): Promise<void> {
  const have = new Set((await table<DriveSource>('drive_sources').list({ fresh: true })).map(s => s.id))
  for (const i of items) {
    for (const h of cardLinksOf(i as never, driveHandInsOf(i as never))) {
      const t = driveLinkTarget(h.link)
      if (!t.ok || have.has(sourceId(i.id, t.id))) continue
      await ensureSource(i, h.link, h.by).catch(() => null)
      have.add(sourceId(i.id, t.id))
    }
  }
}

export type WatchResult = { sources: number; read: number; seen: number; toScan: string[]; errors: number }

/**
 * ONE MINUTE'S CHECK. Each source of a card being made is read; each file not yet seen at its content gets one row,
 * in the state the card and its stage give it (drive-scan-core.firstState). The rows that need the AI are returned.
 */
export async function watchSources(opts: { limit?: number; budgetMs?: number } = {}): Promise<WatchResult> {
  const started = Date.now()
  const budget = opts.budgetMs ?? 40_000
  // only the Editor's cards: never a post uploaded on the Schedule page, a shoot plan or graphics
  const kinds = new Map((await table<WorkKind>('work_kinds').list()).map(k => [k.id, k.slug]))
  const items = await table<ContentItem>('content_items').list({
    where: r => WATCHED_STATUSES.includes(String(r.status ?? '')) && isEditorCard(r as never, kinds.get(String(r.work_kind_id ?? ''))), fresh: true,
  })
  await seedSources(items)
  const byId = new Map(items.map(i => [i.id, i]))
  // the longest-unread first, inside a time budget: a big folder that runs a request out of time must not stop the
  // links behind it from ever being read (live, 21 Oct 2026: "September 18th", 23 files, ended the first check)
  const sources = (await table<DriveSource>('drive_sources').list({ fresh: true })).filter(s => byId.has(s.item_id))
    .sort((a, b) => String(a.last_checked_at ?? '').localeCompare(String(b.last_checked_at ?? '')))
    .slice(0, opts.limit ?? 60)
  const seenTable = table<DriveSeen>('drive_seen')
  const seenRows = await seenTable.list({ fresh: true })
  const seenIds = new Set(seenRows.map(r => r.id))
  const undated = new Set(seenRows.filter(r => !r.created_time).map(r => r.id))
  const out: WatchResult = { sources: sources.length, read: 0, seen: 0, toScan: [], errors: 0 }
  for (const s of sources) {
    if (Date.now() - started > budget) break
    const item = byId.get(s.item_id)!
    const now = new Date().toISOString()
    try {
      const files = await readDriveTarget(s.kind === 'file' ? 'file' : 'folder', s.drive_id, { cuts: true }) as SeenFile[]
      out.read++
      // A FILE TAKEN OUT OF DRIVE (the owner, 22 Oct 2026: "what happens if a video is deleted in the drive?"): once the
      // link reads fine, a file it no longer holds is marked gone — never offered again; the card keeps its own copy
      // (a read cut off at its 400-file limit is not proof a file went)
      if (files.length && files.length < 400) {
        const here = new Set(files.map(f => f.id))
        for (const r of seenRows.filter(x => x.source_id === s.id && x.state !== 'gone' && !here.has(x.drive_file_id))) {
          await seenTable.claim(r.id, cur => cur && cur.state !== 'gone' ? { ...cur, state: 'gone', updated_at: now } as DriveSeen : null).catch(() => undefined)
        }
      }
      // a file seen before Drive's shown date was read gets it now, once (the version stacks order by it)
      for (const f of files) {
        const known = seenId(item.id, f)
        if (!f.created || !undated.has(known)) continue
        await seenTable.update(known, { created_time: f.created } as never).catch(() => undefined)
        undated.delete(known)
      }
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
  // A FILE LEFT WAITING IS ASKED FOR AGAIN: one still "new" ten minutes on (its event lost, or set back for a rescan)
  // is queued again, and stamped so it is asked at most every ten minutes — a scan that never starts is never final
  const stale = await table<DriveSeen>('drive_seen').list({ where: r => r.state === 'new' && Date.now() - Date.parse(r.updated_at) > 10 * 60_000, fresh: true })
  for (const r of stale.slice(0, 60)) {
    if (out.toScan.includes(r.id)) continue
    const put = await table<DriveSeen>('drive_seen').claim(r.id, cur => cur?.state === 'new' ? { ...cur, updated_at: new Date().toISOString() } : null)
    if (put.claimed) out.toScan.push(r.id)
  }
  return out
}


/** when the card last went to Colour grade — the moment after which a new file in its links is a grade */
export async function gradeSinceOf(itemId: string): Promise<string | null> {
  const moves = await table<{ id: string; entity_id?: string; action?: string; new_value?: string; created_at?: string }>('workflow_activity')
    .list({ where: a => a.entity_id === itemId && a.action === 'status_change' && a.new_value === 'colour_grade' })
  return moves.map(a => String(a.created_at ?? '')).filter(Boolean).sort().pop() ?? null
}
