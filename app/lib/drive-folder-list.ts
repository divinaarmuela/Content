import 'server-only'
import { listEntries } from './gdrive-files'
import { PUBLIC_FOLDER_VIEW, parsePublicFolderView, type PublicEntry } from './drive-folder-files-core'
import type { DriveEntry } from './files-core'

/**
 * THE FILES IN ONE DRIVE FOLDER — read only (trap 13). Two ways in: the
 * agency's connected account first (Drive's search, which returns only what
 * that account was shared on outright), then Google's public folder view —
 * the page a folder link shows a stranger — which lists an "anyone with the
 * link" folder the account was never shared on (15 Sep 2026: the card said
 * "No files in the folder yet" over a footage folder holding sixteen clips).
 * The card's tiles and the client's editing portal both list through here.
 */
export const FOLDER_PAGE = 60

export type FolderListing = {
  entries: (DriveEntry & { thumbUrl?: string | null })[]
  more: boolean
  source: 'account' | 'public'
  /** the account could not be asked — the reason, for the words */
  accountFailure: string | null
}

export async function listFolder(folderId: string): Promise<FolderListing> {
  const result = await listEntries({ parentId: folderId, pageSize: FOLDER_PAGE, sort: { by: 'name', dir: 'asc' } })
  if (result.ok && result.entries.length > 0) {
    return { entries: result.entries, more: result.nextPageToken !== null, source: 'account', accountFailure: null }
  }
  const seen = await publicFolderEntries(folderId)
  if (seen.length > 0) {
    return { entries: seen.slice(0, FOLDER_PAGE), more: seen.length > FOLDER_PAGE, source: 'public', accountFailure: null }
  }
  return { entries: [], more: false, source: 'account', accountFailure: result.ok ? null : result.reason }
}

/** the public view: what the folder link shows anyone */
export async function publicFolderEntries(folderId: string): Promise<PublicEntry[]> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(PUBLIC_FOLDER_VIEW(folderId), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MD Media dashboard)' },
      signal: ctrl.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!res.ok) return []
    return parsePublicFolderView(await res.text())
  } catch {
    return []
  }
}
