import { finalFilesForRound } from './final-files-core'
import { fileRound, roundOf } from './edit-round-core'
import { filesOf } from './drive-pull-core'

/**
 * THE PUBLIC SHARE LINK FOR THE ACCEPTED VERSION (the owner, 17 Sep 2026:
 * "once everything is all good there should be an option to extract the
 * accepted version — editors, AMs, all can use it; it's like public sharing,
 * anyone with the link can use it").
 *
 * Once a card is past the client's approval, anyone on the team can mint one
 * link for it. The link opens a page with no sign-in that lists the accepted
 * version's files — the ones uploaded onto the card for that round, and the
 * ones copied in from its finished-edit folder — each with a Download. The
 * dashboard never writes to Drive (gdrive-policy), so this is our own page
 * and our own copies, shared the way a Drive folder set to "anyone with the
 * link" would be.
 *
 * One token per card, kept on the row; Stop sharing clears it and the page
 * goes dark. Pure: the route does the reading and writing.
 */
export const SHAREABLE_STATUSES = ['approved_for_scheduling', 'scheduled', 'published'] as const

export function maySharePublicly(status: unknown): boolean {
  return (SHAREABLE_STATUSES as readonly string[]).includes(String(status ?? ''))
}

export type SharedFile = { id: string; name: string; url: string; mime: string | null; size: number | null }

/** The accepted version's files: the card's current round, uploaded or copied in. */
export function sharedFilesOf(
  item: { id: string; final_files?: unknown; edit_round?: unknown },
  pulls: readonly { scope_id?: string | null; purpose?: string | null; files?: unknown }[],
): SharedFile[] {
  const round = roundOf(item)
  const uploaded: SharedFile[] = finalFilesForRound(item, round)
    .map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? null, size: f.size ?? null }))
  const copied: SharedFile[] = pulls
    .filter(p => p.scope_id === item.id && p.purpose === 'finished')
    .flatMap(p => filesOf(p))
    .filter(f => f.status === 'done' && !!f.url && fileRound(f) === round)
    .map(f => ({ id: f.id, name: f.name, url: f.url as string, mime: f.mime ?? null, size: f.size ?? null }))
  const seen = new Set<string>()
  return [...uploaded, ...copied].filter(f => {
    if (seen.has(f.url)) return false
    seen.add(f.url)
    return true
  })
}

export function sharePath(token: string): string {
  return `/share/${encodeURIComponent(token)}`
}

/** a token is 32 hex characters — anything else is not looked up */
export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}

/** what the public page says under the title */
export function shareWords(files: readonly SharedFile[], version: number): string {
  if (files.length === 0) return `Version ${version} is accepted, but its files are still being copied in — try again in a minute.`
  return `Version ${version}, accepted. ${files.length} ${files.length === 1 ? 'file' : 'files'} — press Download on each.`
}
