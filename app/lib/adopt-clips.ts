import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import { finishedEditOf, driveTargetOf } from './card-link-core'
import { filesOf, pullId } from './drive-pull-core'
import { adoptedFromPull, finalFilesOf, needsAdoption, type FinalFile } from './final-files-core'

/**
 * A LINK CARD'S CLIPS BECOME ITS ASSETS — the server half (final-files-core.ts
 * says why). Reads the finished link's copies, writes them as the card's
 * Version 1 files inside a claim: only a card with NO files of its own is
 * changed, so two presses, or a press racing an upload, produce one answer.
 */
export async function adoptClips(item: ContentItem, by: string | null): Promise<{ adopted: number; files: FinalFile[]; reason?: string }> {
  if (!needsAdoption(item as never)) return { adopted: 0, files: finalFilesOf(item as never), reason: 'already has files' }
  const finished = finishedEditOf(item as never)
  const target = finished ? driveTargetOf(finished.url) : null
  if (!target) return { adopted: 0, files: [], reason: 'not a Drive link' }
  const pull = await table<DrivePull>('drive_pulls').get(pullId(target.id, item.id)).catch(() => null)
  const files = adoptedFromPull(filesOf(pull), by, new Date().toISOString())
  if (files.length === 0) return { adopted: 0, files: [], reason: 'the clips have not been copied yet' }
  const result = await table<ContentItem>('content_items').claim(item.id, ((cur: ContentItem | null): unknown => {
    if (!cur || finalFilesOf(cur as never).length > 0) return null
    return { ...cur, final_files: files, updated_at: new Date().toISOString() }
  }) as (c: ContentItem | null) => ContentItem | null)
  return result.claimed ? { adopted: files.length, files } : { adopted: 0, files: finalFilesOf(result.current as never), reason: 'already has files' }
}
