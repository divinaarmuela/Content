import 'server-only'
import { supabase } from '@/lib/supabase'
import { AuthzError, type TeamUser } from './authz'
import {
  actingRoles, schedulerIdsOf, SCHEDULER_STATUSES, CLIENT_LABELS, type ItemStatus,
} from './workflow-core'
import { visibleComments } from './comment-access-core'

/**
 * Every id interpolated into a PostgREST `.or()` string passes through here.
 *
 * These ids are database-sourced today, which is exactly the kind of fact that
 * quietly stops being true. A filter string is not parameterised, so a value
 * carrying a comma or a paren would rewrite the filter around it; this makes
 * that impossible rather than merely unlikely.
 */
export function assertUuid(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new AuthzError('Bad identifier', 400)
  }
  return id
}

/**
 * May this team user open a shoot?
 *
 * Client membership or having created the shoot — and, since 27 Aug,
 * HOLDING A JOB ON IT: the brief task handed to a manager off the client
 * team is the shoot's own plan, and "you are not assigned to this client"
 * on the page that plan lives on made the assignment meaningless.
 * Assignment is the grant, exactly as loadItemForUser already treats items.
 */
export async function canOpenBatch(
  user: TeamUser,
  batch: { id: string; client_id: string; owner_id?: string | null },
): Promise<boolean> {
  const ids = await batchClientIds(user)
  if (ids === null || ids.includes(batch.client_id) || batch.owner_id === user.id) return true
  if (user.role === 'client') return false
  const me = assertUuid(user.id)
  const { data } = await supabase
    .from('content_items')
    .select('id')
    .eq('batch_id', batch.id)
    .or(`owner_id.eq.${me},scheduler_ids.cs.["${me}"]`)
    .limit(1)
  if ((data?.length ?? 0) > 0) return true
  // tagged in the shoot's own comment thread: the email deep-links here, and
  // a link to "you are not on this client" is worse than no link
  return (await taggedBatchIds(user)).includes(batch.id)
}

/** Shoots this user was TAGGED on — a shoot comment assigned to them. Empty
 *  (never an error) on a database where shoot_comment_tags.sql has not run. */
export async function taggedBatchIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const { data, error } = await supabase
    .from('batch_comments')
    .select('batch_id')
    .eq('assigned_to', user.id)
    .limit(500)
  if (error) return []
  return [...new Set((data ?? []).map(r => r.batch_id as string).filter(Boolean))]
}

/**
 * Where somebody is still WAITING on this user: the items and shoots with an
 * unresolved comment tagged to them. The board badge, the Overview's
 * "Waiting on you" card and the bell all read this one answer.
 */
export async function openTaggedIds(user: TeamUser): Promise<{ items: string[]; batches: string[] }> {
  if (user.role === 'client') return { items: [], batches: [] }
  const [items, batches] = await Promise.all([
    supabase.from('item_comments').select('item_id').eq('assigned_to', user.id).eq('resolved', false).limit(500),
    supabase.from('batch_comments').select('batch_id').eq('assigned_to', user.id).eq('resolved', false).limit(500),
  ])
  return {
    items: [...new Set((items.data ?? []).map(r => r.item_id as string).filter(Boolean))],
    // the shoot tags column may not exist yet — no rows, not an error
    batches: batches.error ? [] : [...new Set((batches.data ?? []).map(r => r.batch_id as string).filter(Boolean))],
  }
}

/**
 * Shoots this team user holds a stake in — one they OWN, or one carrying an
 * item they own or were handed the scheduling of. These are exactly the
 * shoots canOpenBatch opens for a person who is not on the client team, so
 * every LIST of shoots must include them too, or the person is told "you can
 * open this" by a page they cannot find. Owning the shoot was the case the
 * first pass missed: canOpenBatch let the creator in, the list left them out.
 */
export async function heldBatchIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const me = assertUuid(user.id)
  const [viaItems, owned, tagged] = await Promise.all([
    supabase
      .from('content_items')
      .select('batch_id')
      .not('batch_id', 'is', null)
      .or(`owner_id.eq.${me},scheduler_ids.cs.["${me}"]`)
      .limit(500),
    supabase.from('batches').select('id').eq('owner_id', user.id).limit(500),
    taggedBatchIds(user),
  ])
  return [...new Set([
    ...(viaItems.data ?? []).map(r => r.batch_id as string),
    ...(owned.data ?? []).map(r => r.id as string),
    ...tagged,
  ].filter(Boolean))]
}

/** Items this user was TAGGED on — a comment assigned to them. Being asked a
 *  question about a piece is an assignment: the email deep-links straight to
 *  it, and a link to a 404 is worse than no link. */
export async function taggedItemIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const { data } = await supabase
    .from('item_comments')
    .select('item_id')
    .eq('assigned_to', user.id)
    .limit(500)
  return [...new Set((data ?? []).map(r => r.item_id as string).filter(Boolean))]
}

/**
 * ASSIGNMENT IS THE GRANT, as one PostgREST filter.
 *
 * Everything that opens an item for someone who is not on its client team:
 * owning it, holding its scheduling, being tagged on it, or holding the shoot
 * it sits under. `loadItemForUser` grants exactly this set one row at a time;
 * every LIST has to use the same set, or a page shows a person less than the
 * item page will let them open — which is the bug James hit — and a shoot page
 * lists items whose detail page 404s, which is the same bug facing the other
 * way.
 */
export async function assignedItemsFilter(user: TeamUser): Promise<string> {
  const me = assertUuid(user.id)
  const parts = [`owner_id.eq.${me}`, `scheduler_ids.cs.["${me}"]`]
  const [batches, tagged] = await Promise.all([heldBatchIds(user), taggedItemIds(user)])
  if (batches.length) parts.push(`batch_id.in.(${batches.map(assertUuid).join(',')})`)
  if (tagged.length) parts.push(`id.in.(${tagged.map(assertUuid).join(',')})`)
  return parts.join(',')
}

/** The item ids assignment opens, for the surfaces that filter in memory
 *  (the schedule calendar joins through schedule_entries, so it cannot
 *  express the rule as a query filter). */
export async function heldItemIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const { data } = await supabase
    .from('content_items')
    .select('id')
    .or(await assignedItemsFilter(user))
    .limit(1000)
  return (data ?? []).map(r => r.id as string)
}

/**
 * Client ids a team member may see the CONTEXT of: the clients they are on,
 * plus the clients of everything assignment already opens for them.
 *
 * `accessibleClientIds` answers "whose work is mine to run"; this answers
 * "whose name, brand and agreement may I be shown". Being handed one shoot
 * brief has to bring the client's name and deliverable quotas with it — the
 * shoot page prints both — without making that client's whole portfolio
 * yours. null stays null: super admins and schedulers are not client-scoped.
 */
export async function visibleClientIds(user: TeamUser): Promise<string[] | null> {
  const base = await accessibleClientIds(user)
  if (base === null || user.role === 'client') return base
  const held = await heldBatchIds(user)
  const [{ data: itemRows }, { data: batchRows }] = await Promise.all([
    supabase.from('content_items').select('client_id').or(await assignedItemsFilter(user)).limit(1000),
    held.length
      ? supabase.from('batches').select('client_id').in('id', held)
      : Promise.resolve({ data: [] as { client_id: string }[] }),
  ])
  return [...new Set([
    ...base,
    ...(itemRows ?? []).map(r => r.client_id as string),
    ...(batchRows ?? []).map(r => r.client_id as string),
  ].filter(Boolean))]
}

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

  if (user.role === 'scheduler') {
    if (
      !SCHEDULER_STATUSES.includes(item.status as ItemStatus)
      && item.owner_id !== user.id  // a scheduler assigned the job sees the job
    ) {
      throw new AuthzError('Item not found', 404) // invisible to schedulers pre-approval
    }
    // the seat is TAKEN: once an item has been handed to specific people, a
    // scheduler who is not one of them holds no hat on it, and reading it is
    // reading someone else's job. Status alone used to let them through.
    const handed = schedulerIdsOf(item)
    if (handed.length > 0 && !handed.includes(user.id) && item.owner_id !== user.id) {
      throw new AuthzError('Item not found', 404)
    }
  }
  const clientIds = await accessibleClientIds(user)
  if (clientIds !== null && !clientIds.includes(item.client_id)) {
    if (user.role === 'client' || !(await assignmentOpensItem(user, item))) {
      throw new AuthzError('Item not found', 404) // don't reveal existence
    }
  }
  return item
}

/**
 * The four ways an assignment opens ONE item for someone off its client team.
 *
 * Held directly (owner, or handed the scheduling); tagged in a comment; or
 * sitting under a shoot this person holds — because the shoot page lists
 * every item on the shoot, and a list whose rows 404 on click is the same
 * broken promise as a page that hides work you were given. Runs only on the
 * deny path, so the common case still costs nothing.
 */
async function assignmentOpensItem(
  user: TeamUser,
  item: { id: string; batch_id?: string | null; owner_id?: string | null; scheduler_ids?: unknown },
): Promise<boolean> {
  if (item.owner_id === user.id || schedulerIdsOf(item).includes(user.id)) return true
  const { data: tag } = await supabase
    .from('item_comments')
    .select('id').eq('item_id', item.id).eq('assigned_to', user.id).limit(1)
  if ((tag?.length ?? 0) > 0) return true
  if (!item.batch_id) return false
  const { data: batch } = await supabase
    .from('batches').select('id, client_id, owner_id').eq('id', item.batch_id).maybeSingle()
  return batch ? await canOpenBatch(user, batch) : false
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

/** HAT-shaped serialization — the enforcement of the link-visibility matrix.
 *
 *  Shaped by the hats the viewer wears ON THIS ITEM, not by their job title:
 *  someone handed the scheduling gets the scheduler's slice whatever their
 *  role, and an editor holding nothing here gets no more than a scheduler
 *  would. Clients never receive the internal master link or internal comments; schedulers
 *  receive only the latest version's final links. This lives at the API layer
 *  so even direct API calls only ever get the caller's slice. */
export function shapeItemDetail(
  user: TeamUser,
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
