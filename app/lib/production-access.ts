import 'server-only'
import { supabase } from '@/lib/supabase'
import { AuthzError, type TeamUser } from './authz'
import { SCHEDULER_STATUSES, CLIENT_LABELS, type ItemStatus } from './workflow-core'

/** Client ids this team user may touch. null = unrestricted (super_admin). */
export async function accessibleClientIds(user: TeamUser): Promise<string[] | null> {
  if (user.role === 'super_admin') return null
  if (user.role === 'client') return user.client_id ? [user.client_id] : []
  if (user.role === 'scheduler') return null // scheduler is gated by STATUS, not client
  const { data } = await supabase
    .from('team_user_clients')
    .select('client_id')
    .eq('team_user_id', user.id)
  return (data ?? []).map(r => r.client_id)
}

/** Client ids for SHOOT/batch access. Unlike items, batches have no status
 *  gate, so a scheduler must be scoped by assignment here — returning null
 *  (unrestricted) for schedulers would expose every client's unreleased
 *  concepts. Only super_admin is unrestricted. */
export async function batchClientIds(user: TeamUser): Promise<string[] | null> {
  if (user.role === 'super_admin') return null
  if (user.role === 'client') return user.client_id ? [user.client_id] : []
  const { data } = await supabase
    .from('team_user_clients')
    .select('client_id')
    .eq('team_user_id', user.id)
  return (data ?? []).map(r => r.client_id)
}

/** Assert this user may see this item at all; returns the item row. */
export async function loadItemForUser(user: TeamUser, itemId: string) {
  const { data: item, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (error) throw new AuthzError(error.message, 500)
  if (!item) throw new AuthzError('Item not found', 404)

  if (
    user.role === 'scheduler'
    && !SCHEDULER_STATUSES.includes(item.status as ItemStatus)
    && item.owner_id !== user.id  // a scheduler assigned the job sees the job
  ) {
    throw new AuthzError('Item not found', 404) // invisible to schedulers pre-approval
  }
  const clientIds = await accessibleClientIds(user)
  if (clientIds !== null && !clientIds.includes(item.client_id)) {
    // ownership grants visibility: the assigned editor sees their job even
    // without a whole-client assignment
    if (!(user.role !== 'client' && item.owner_id === user.id)) {
      throw new AuthzError('Item not found', 404) // don't reveal existence
    }
  }
  return item
}

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

/** Role-shaped serialization — the enforcement of the link-visibility matrix.
 *  Clients never receive dropbox_url or internal comments; schedulers receive
 *  only the latest version's final links. This lives at the API layer so even
 *  direct API calls only ever get the caller's slice. */
export function shapeItemDetail(
  user: TeamUser,
  item: Record<string, unknown>,
  versions: VersionRow[],
  comments: CommentRow[],
) {
  const status = item.status as ItemStatus

  // the job pack (brief, raw footage) is internal production material —
  // clients never see it, and schedulers work from final links only
  const { raw_assets_url: _raw, brief: _brief, raw_assets: _files, ...itemPublic } =
    item as Record<string, unknown> & { raw_assets_url?: unknown; brief?: unknown; raw_assets?: unknown }
  void _raw; void _brief; void _files

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
      comments: comments.filter(c => c.visibility === 'client'),
    }
  }

  if (user.role === 'scheduler') {
    const latest = versions[0]
    // schedulers stay out of revision loops (doc 1 §3) — but the thread
    // BETWEEN them and whoever handed them the job is theirs to read: their
    // own notes, their assignor's, and anything explicitly assigned to them
    const assigner = (item as { assigned_by?: string | null }).assigned_by ?? null
    const theirs = new Set([user.id, ...(assigner ? [assigner] : [])])
    return {
      ...itemPublic,
      versions: latest
        ? [{ id: latest.id, version_number: latest.version_number, created_at: latest.created_at, file_url: latest.file_url, drive_url: latest.drive_url }]
        : [],
      comments: comments.filter(c =>
        c.visibility === 'internal'
        && ((c.author_id !== null && theirs.has(c.author_id)) || c.assigned_to === user.id)),
    }
  }

  if (user.role === 'editor') {
    // full versions, but the thread narrows to the editor's own lane: what
    // they wrote, what their assignor wrote, and anything tagged to them.
    // Managers speak to an editor by tagging them — never by broadcast.
    const assigner = (item as { assigned_by?: string | null }).assigned_by ?? null
    const theirs = new Set([user.id, ...(assigner ? [assigner] : [])])
    return {
      ...item,
      versions,
      comments: comments.filter(c =>
        c.visibility === 'internal'
        && ((c.author_id !== null && theirs.has(c.author_id)) || c.assigned_to === user.id)),
    }
  }

  // AM / super_admin: the whole record — every comment, every version
  return { ...item, versions, comments }
}
