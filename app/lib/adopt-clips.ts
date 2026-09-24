import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import { filesOf } from './drive-pull-core'
import { finalFilesOf, mergeHandIn, type FinalFile } from './final-files-core'
import { roundOf } from './edit-round-core'

/**
 * EVERY DRIVE HAND-IN ON A CARD BECOMES ITS FILES (the owner, 24 Sep 2026: "didnt i tell u track everything as
 * files instead of drive links").
 *
 * An editor hands work in by Drive in two ways: one folder, or one file link after another, each pasted over the
 * last. Only the CURRENT link used to become files — Justin Engelke's First Shoot was four links (Script 1, 5, 2, 6)
 * and the card, the quality check and the client portal had only Script 6; Jordan Wilson's second folder never
 * became files at all.
 *
 * Now every finished copy made for the card is merged into its files (final-files-core.mergeHandIn: the same Drive
 * file is carried, a same-named clip is its next version, anything else is a new clip), once per copy — the card
 * lists the copies it has taken in `adopted_pulls`, so a file an editor later took off is not brought back. A copy
 * made before that list existed counts as taken in when any of its files is on the card.
 * Called when a copy finishes (drive-pull.finishPull), when the card is opened, and before a send-back.
 */
export async function adoptClips(item: ContentItem, by: string | null): Promise<{ adopted: number; files: FinalFile[]; reason?: string }> {
  const pulls = (await table<DrivePull>('drive_pulls').list({
    where: p => p.scope_id === item.id && p.kind === 'item' && (p as { purpose?: string | null }).purpose === 'finished'
      && !(p as { cancelled_at?: string | null }).cancelled_at,
  }).catch(() => [] as DrivePull[]))
    .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  if (pulls.length === 0) return { adopted: 0, files: finalFilesOf(item as never), reason: 'nothing copied from Drive' }
  const now = new Date().toISOString()
  let added = 0
  const result = await table<ContentItem>('content_items').claim(item.id, ((cur: ContentItem | null): unknown => {
    if (!cur) return null
    let files = finalFilesOf(cur as never)
    const onCard = new Set(files.map(x => x.id))
    const taken = new Set(Array.isArray((cur as { adopted_pulls?: unknown }).adopted_pulls) ? ((cur as unknown as { adopted_pulls: unknown[] }).adopted_pulls).map(String) : [])
    const nowTaken: string[] = []
    added = 0
    for (const p of pulls) {
      if (taken.has(p.id)) continue
      const pulled = filesOf(p)
      if (pulled.length === 0 || pulled.some(x => x.status !== 'done' && x.status !== 'failed')) continue   // still copying
      if (pulled.some(x => onCard.has(x.id))) { nowTaken.push(p.id); continue }                          // taken in before the list existed
      const v = Number((p as { version?: unknown }).version)
      const round = Number.isFinite(v) && v >= 1 ? v : Math.max(1, roundOf(cur as never))
      const merged = mergeHandIn(files, pulled, round, by, now)
      files = merged.files
      added += merged.added
      for (const x of files) onCard.add(x.id)
      nowTaken.push(p.id)
    }
    if (nowTaken.length === 0) return null
    return { ...cur, final_files: files, adopted_pulls: [...taken, ...nowTaken], updated_at: now }
  }) as (c: ContentItem | null) => ContentItem | null)
  if (!result.claimed) return { adopted: 0, files: finalFilesOf(item as never), reason: 'nothing new copied' }
  return { adopted: added, files: finalFilesOf(result.row as never) }
}
