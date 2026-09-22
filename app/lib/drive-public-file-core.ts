// pure: no server import — the view address is spelled here
import type { DriveEntry } from './files-core'

/**
 * A DRIVE FILE AS ANYONE WITH THE LINK SEES IT — the pure half.
 *
 * Our connected account is refused by id on a file it was never shared on
 * (22 Sep 2026, The Glass Den's clips: the folder lists through Google's
 * public view, every by-id call 404s, and the listing carries no resource
 * key). Google still tells a stranger the file's name and size (the public
 * download's headers, read by driveFileMeta) and draws its picture (the
 * public thumbnail address). This shapes those into the entry the pages
 * already draw. Read only: nothing here writes anywhere.
 */

/** Google's public thumbnail address — what the file's own link page draws */
export const PUBLIC_THUMBNAIL = (id: string, size: number) =>
  `https://drive.google.com/thumbnail?${new URLSearchParams({ id, sz: `w${Math.max(16, Math.min(2048, Math.round(size)))}` })}`

export type PublicFileMeta = { name: string; mime: string; size: number | null; modified: string | null }

/** the entry the info panel and the post card draw, from what a stranger can read */
export function publicFileEntry(id: string, meta: PublicFileMeta): DriveEntry & { parents: string[] } {
  return {
    id,
    name: meta.name || id,
    mimeType: meta.mime || 'application/octet-stream',
    size: meta.size,
    modified: meta.modified,
    ownerName: null,
    ownerEmail: null,
    // the public thumbnail address answers for any file Google can picture; the route says 404 when it cannot
    hasThumbnail: true,
    webViewLink: `https://drive.google.com/file/d/${id}/view`,
    parents: [],
  }
}
