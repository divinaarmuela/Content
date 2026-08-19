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

/** Assert this user may see this item at all; returns the item row. */
export async function loadItemForUser(user: TeamUser, itemId: string) {
  const { data: item, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (error) throw new AuthzError(error.message, 500)
  if (!item) throw new AuthzError('Item not found', 404)

  if (user.role === 'scheduler' && !SCHEDULER_STATUSES.includes(item.status as ItemStatus)) {
    throw new AuthzError('Item not found', 404) // invisible to schedulers pre-approval
  }
  const clientIds = await accessibleClientIds(user)
  if (clientIds !== null && !clientIds.includes(item.client_id)) {
    throw new AuthzError('Item not found', 404) // don't reveal existence
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
    return {
      ...itemPublic,
      status_label: CLIENT_LABELS[status],
      versions: latest
        ? [{ id: latest.id, version_number: latest.version_number, created_at: latest.created_at, file_url: latest.file_url, drive_url: latest.drive_url }]
        : [],
      comments: comments.filter(c => c.visibility === 'client'),
    }
  }

  if (user.role === 'scheduler') {
    const latest = versions[0]
    return {
      ...itemPublic,
      versions: latest
        ? [{ id: latest.id, version_number: latest.version_number, created_at: latest.created_at, file_url: latest.file_url, drive_url: latest.drive_url }]
        : [],
      comments: [], // schedulers stay out of revision loops (doc 1 §3)
    }
  }

  // editor / AM / super_admin: full versions; editors never see client comments
  return {
    ...item,
    versions,
    comments: user.role === 'editor' ? comments.filter(c => c.visibility === 'internal') : comments,
  }
}
