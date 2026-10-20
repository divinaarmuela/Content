/**
 * ARCHIVE (the owner, 20 Oct 2026: "for every shoots editor design boards. add an archive feature please which also
 * removes it from the portal … so we dont have to see it in the page and its clean").
 *
 * A shoot, a work card (Editor, Designer) or a board can be put away: `archived_at` is stamped, and from then on it
 * is off the team's lists — behind an "Archived" view where it can be brought back — and off the client's portal
 * entirely. Nothing is deleted, moved or changed: its files, comments, versions and history stay exactly as they were,
 * and bringing it back puts it where it was. Pure.
 */

export type Archivable = { archived_at?: string | null }

export function isArchived(row: Archivable | null | undefined): boolean {
  return !!row?.archived_at
}

/** what a list shows: the live rows, or — in the Archived view — only the archived ones */
export function byArchive<T extends Archivable>(rows: readonly T[], showArchived = false): T[] {
  return rows.filter(r => isArchived(r) === showArchived)
}

/** what the client's portal may show: never an archived row */
export function notArchived<T extends Archivable>(rows: readonly T[]): T[] {
  return rows.filter(r => !isArchived(r))
}

/** the write for Archive / Bring back */
export function archivePatch(archive: boolean, userId: string, now = new Date()): { archived_at: string | null; archived_by: string | null } {
  return archive ? { archived_at: now.toISOString(), archived_by: userId } : { archived_at: null, archived_by: null }
}

/** the words on the button and in the toast */
export function archiveWords(kind: 'shoot' | 'card' | 'board', archived: boolean): { button: string; done: string } {
  const what = kind === 'shoot' ? 'Shoot' : kind === 'card' ? 'Card' : 'Board'
  return archived
    ? { button: 'Bring back', done: `${what} brought back` }
    : { button: 'Archive', done: `${what} archived — it is off this page and the client's portal` }
}

export type ArchiveKind = 'shoot' | 'card' | 'board'

/**
 * WHO MAY ARCHIVE. A shoot: whoever runs its page (the server checks canManageBatch). A board: the managers, who
 * already name and delete boards. A card: the managers and a general user, or the editor or designer whose card it
 * is — unlike Delete, a finished or posted card may be archived; that is what clearing a page is for.
 */
export function mayArchiveCard(viewer: { id: string; role: string }, card: { owner_id?: unknown; assigned_by?: unknown }): boolean {
  if (['super_admin', 'account_manager', 'general'].includes(viewer.role)) return true
  if (viewer.role !== 'editor' && viewer.role !== 'designer') return false
  return card.owner_id === viewer.id || card.assigned_by === viewer.id
}
