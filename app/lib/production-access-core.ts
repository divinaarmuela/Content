/**
 * The PURE half of production access — no `server-only`, no `@/lib/db`.
 *
 * `production-access.ts` reads the database to answer "what may this person
 * see"; everything in here decides it from rows already in hand. The browser
 * now renders the boards straight from live database listeners, so the same
 * decisions have to be makeable in a client bundle — and they have to be the
 * SAME decisions, which is why this is one module both halves import rather
 * than a second copy of the rules.
 *
 * `production-access.ts` re-exports every symbol below, so the server keeps
 * importing from where it always did.
 */

import {
  actingRoles, CLIENT_LABELS, type ItemStatus,
} from './workflow-core'
import { visibleComments } from './comment-access-core'
import type { Role } from './identity-core'

/** The viewer, as much of them as the pure rules ever need. */
export type ScopeViewer = { id: string; role: Role; client_id?: string | null }

type VersionRow = {
  id: string; version_number: number; created_at: string
  file_url: string; dropbox_url: string; drive_url: string
  notes: string | null; uploaded_by: string | null
}
type CommentRow = {
  id: string; created_at: string; author_id: string | null; visibility: string
  body: string; video_timestamp_sec: number | null; assigned_to: string | null
  resolved: boolean; parent_id: string | null
}

/** HAT-shaped serialization — the enforcement of the link-visibility matrix.
 *
 *  Shaped by the hats the viewer wears ON THIS ITEM, not by their job title:
 *  someone handed the scheduling gets the scheduler's slice whatever their
 *  role, and an editor holding nothing here gets no more than a scheduler
 *  would. Clients never receive the internal master link or internal comments; schedulers
 *  receive only the latest version's final links. This lives at the API layer
 *  so even direct API calls only ever get the caller's slice. */
export function shapeItemDetail(
  user: ScopeViewer,
  item: Record<string, unknown>,
  versions: VersionRow[],
  comments: CommentRow[],
) {
  const status = item.status as ItemStatus
  const hats = actingRoles(
    { id: user.id, role: user.role },
    item as { owner_id?: string | null; scheduler_ids?: unknown },
  )

  // the job pack (brief, raw footage, the Drive working folder) is internal
  // production material — clients never see it, and schedulers work from
  // final links only. The Drive folder goes in this list for the same reason
  // raw_assets_url does: it is the unedited material.
  const {
    raw_assets_url: _raw, brief: _brief, raw_assets: _files,
    drive_url: _driveUrl, drive_folder_id: _driveId, ...itemPublic
  } = item as Record<string, unknown> & {
    raw_assets_url?: unknown; brief?: unknown; raw_assets?: unknown
    drive_url?: unknown; drive_folder_id?: unknown
  }
  void _raw; void _brief; void _files; void _driveUrl; void _driveId

  if (user.role === 'client') {
    const latest = versions[0]
    // internal workings stay internal: who edits, who schedules, who assigned
    // — and the raw status, which status_label exists to translate
    const {
      owner_id: _o, assigned_by: _a, scheduler_ids: _s, status: _st,
      ...clientSafe
    } = itemPublic as Record<string, unknown>
    void _o; void _a; void _s; void _st
    return {
      ...clientSafe,
      status_label: CLIENT_LABELS[status],
      versions: latest
        ? [{ id: latest.id, version_number: latest.version_number, created_at: latest.created_at, file_url: latest.file_url, drive_url: latest.drive_url }]
        : [],
      comments: visibleComments(user.role, user.id, comments),
      acting_roles: hats,
    }
  }

  // reviewing IS the job and it is not per-item — a manager (or a super
  // admin) reads the whole record: every comment, every version
  if (hats.includes('account_manager') || hats.includes('super_admin')) {
    return { ...item, versions, comments, acting_roles: hats }
  }

  if (hats.includes('editor')) {
    // full versions, but the thread narrows to the editor's own lane: a
    // manager reaches them by TAGGING them, never by broadcast
    return {
      ...item,
      versions,
      comments: visibleComments('editor', user.id, comments),
      acting_roles: hats,
    }
  }

  // the scheduler's slice — and the floor for any team viewer holding no hat
  // on this item at all. Schedulers stay out of revision loops (doc 1 §3):
  // they see the final links and read only the conversations they are in.
  const latest = versions[0]
  return {
    ...itemPublic,
    versions: latest
      ? [{ id: latest.id, version_number: latest.version_number, created_at: latest.created_at, file_url: latest.file_url, drive_url: latest.drive_url }]
      : [],
    comments: visibleComments('scheduler', user.id, comments),
    acting_roles: hats,
  }
}
