import 'server-only'
import { table } from '@/lib/db'
import type { Batch, ContentItem, ItemComment, BatchComment, TeamUserClient, WorkflowActivity } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { schedulerIdsOf, SCHEDULER_STATUSES, type ItemStatus } from './workflow-core'
import { canManageShoot, isOnShoot, type SopManager } from './shoot-sop-core'

/**
 * Every id the access helpers build a query around passes through here.
 *
 * These ids are database-sourced today, which is exactly the kind of fact that
 * quietly stops being true — a caller-supplied id reaching a filter unchecked
 * is how "whose rows are these" stops being a question with one answer. This
 * makes a malformed identifier impossible rather than merely unlikely.
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
  batch: { id: string; client_id: string; owner_id?: string | null; editor_id?: string | null; crew_ids?: unknown },
): Promise<boolean> {
  const ids = await batchClientIds(user)
  if (ids === null || ids.includes(batch.client_id) || batch.owner_id === user.id) return true
  if (user.role === 'client') return false
  // on the shoot — its editor or its crew (the Shoot Brief SOP, 11 Sep 2026)
  if (isOnShoot(batch, user.id)) return true
  const me = assertUuid(user.id)
  const held = await table<ContentItem>('content_items').list({
    by: { batch_id: batch.id },
    where: r => r.owner_id === me || schedulerIdsOf(r).includes(me),
    limit: 1,
  })
  if (held.length > 0) return true
  // tagged in the shoot's own comment thread: the email deep-links here, and
  // a link to "you are not on this client" is worse than no link
  return (await taggedBatchIds(user)).includes(batch.id)
}

/** Shoots this user was TAGGED on — a shoot comment assigned to them. Empty
 *  (never an error) on a database where shoot_comment_tags.sql has not run. */
export async function taggedBatchIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  try {
    const rows = await table<BatchComment & { assigned_to?: string | null }>('batch_comments')
      .list({ where: r => r.assigned_to === user.id, limit: 500 })
    return [...new Set(rows.map(r => r.batch_id).filter(Boolean))]
  } catch {
    return []
  }
}

/**
 * Where somebody is still WAITING on this user: the items and shoots with an
 * unresolved comment tagged to them. The board badge, the Overview's
 * "Waiting on you" card and the bell all read this one answer.
 */
export async function openTaggedIds(user: TeamUser): Promise<{ items: string[]; batches: string[] }> {
  if (user.role === 'client') return { items: [], batches: [] }
  const [items, batches] = await Promise.all([
    table<ItemComment>('item_comments')
      .list({ where: r => r.assigned_to === user.id && r.resolved === false, limit: 500 }),
    // the shoot tags column may not exist yet — no rows, not an error
    table<BatchComment & { assigned_to?: string | null; resolved?: boolean }>('batch_comments')
      .list({ where: r => r.assigned_to === user.id && r.resolved === false, limit: 500 })
      .catch(() => []),
  ])
  return {
    items: [...new Set(items.map(r => r.item_id).filter(Boolean))],
    batches: [...new Set(batches.map(r => r.batch_id).filter(Boolean))],
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
  const [viaItems, owned, tagged, onShoot] = await Promise.all([
    table<ContentItem>('content_items').list({
      where: r => r.batch_id != null && (r.owner_id === me || schedulerIdsOf(r).includes(me)),
      limit: 500,
    }),
    table<Batch>('batches').list({ by: { owner_id: user.id }, limit: 500 }),
    taggedBatchIds(user),
    // the shoots this person is ON — their editor, or on their crew
    table<Batch>('batches').list({ where: r => isOnShoot(r, me), limit: 500 }),
  ])
  return [...new Set([
    ...viaItems.map(r => r.batch_id as string),
    ...owned.map(r => r.id),
    ...tagged,
    ...onShoot.map(r => r.id),
  ].filter(Boolean))]
}

/** Items this user was TAGGED on — a comment assigned to them. Being asked a
 *  question about a piece is an assignment: the email deep-links straight to
 *  it, and a link to a 404 is worse than no link. */
export async function taggedItemIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const rows = await table<ItemComment>('item_comments')
    .list({ where: r => r.assigned_to === user.id, limit: 500 })
  return [...new Set(rows.map(r => r.item_id).filter(Boolean))]
}

/**
 * The items this person CREATED — a grant like a tag, read off the activity
 * log because `content_items` carries no created_by. A failed read is
 * LOGGED and returns nothing: the board would quietly re-hide what they
 * made, which is exactly the silent failure CLAUDE.md warns about, so it
 * must at least be visible in the logs. Newest first, so a prolific creator
 * loses their oldest rows past the cap, never their latest.
 */
export async function createdItemIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client' || user.role === 'super_admin') return []
  try {
    const rows = await table<WorkflowActivity>('workflow_activity').list({
      where: a => a.actor_id === user.id && a.entity_type === 'content_item' && a.action === 'created',
      orderBy: [['created_at', 'desc']],
      limit: 3000,
    })
    return [...new Set(rows.map(a => a.entity_id).filter(Boolean))]
  } catch (err) {
    console.error('[scope] could not read created items for', user.id, err)
    return []
  }
}

/**
 * ASSIGNMENT IS THE GRANT, as one predicate every list shares.
 *
 * Everything that opens an item for someone who is not on its client team:
 * owning it, holding its scheduling, being tagged on it, or holding the shoot
 * it sits under. `loadItemForUser` grants exactly this set one row at a time;
 * every LIST has to use the same set, or a page shows a person less than the
 * item page will let them open — which is the bug James hit — and a shoot page
 * lists items whose detail page 404s, which is the same bug facing the other
 * way.
 *
 * The shoot and tag ids are resolved ONCE, when the predicate is built, so a
 * list filtering ten thousand rows through it still costs the two reads.
 */
export async function assignedItemsFilter(
  user: TeamUser,
): Promise<(item: ContentItem) => boolean> {
  const me = assertUuid(user.id)
  const [batches, tagged] = await Promise.all([heldBatchIds(user), taggedItemIds(user)])
  const heldBatches = new Set(batches.map(assertUuid))
  const taggedItems = new Set(tagged.map(assertUuid))
  return (item: ContentItem) =>
    item.owner_id === me
    || schedulerIdsOf(item).includes(me)
    || (item.batch_id != null && heldBatches.has(item.batch_id))
    || taggedItems.has(item.id)
    // the quality reviewer's desk
    || (user.quality_reviewer === true && item.status === 'quality_check')
}

/** The item ids assignment opens, for the surfaces that filter in memory
 *  (the schedule calendar joins through schedule_entries, so it cannot
 *  express the rule as a query filter). */
export async function heldItemIds(user: TeamUser): Promise<string[]> {
  if (user.role === 'client') return []
  const assigned = await assignedItemsFilter(user)
  const rows = await table<ContentItem>('content_items').list({ where: assigned, limit: 1000 })
  return rows.map(r => r.id)
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
  const assigned = await assignedItemsFilter(user)
  const [itemRows, batchRows] = await Promise.all([
    table<ContentItem>('content_items').list({ where: assigned, limit: 1000 }),
    held.length
      ? table<Batch>('batches').list({ where: r => held.includes(r.id) })
      : Promise.resolve([] as Batch[]),
  ])
  return [...new Set([
    ...base,
    ...itemRows.map(r => r.client_id),
    ...batchRows.map(r => r.client_id),
  ].filter(Boolean))]
}

/** Client ids this team user may touch. null = unrestricted (super_admin). */
export async function accessibleClientIds(user: TeamUser): Promise<string[] | null> {
  if (user.role === 'super_admin') return null
  if (user.role === 'client') return user.client_id ? [user.client_id] : []
  if (user.role === 'scheduler') return null // scheduler is gated by STATUS, not client
  if (user.role === 'general') return null   // "she can create briefs for any client" (9 Sep 2026)
  const rows = await table<TeamUserClient>('team_user_clients')
    .list({ by: { team_user_id: user.id } })
  return rows.map(r => r.client_id)
}

/** Client ids for SHOOT/batch access. Unlike items, batches have no status
 *  gate, so a scheduler must be scoped by assignment here — returning null
 *  (unrestricted) for schedulers would expose every client's unreleased
 *  concepts. Only super_admin is unrestricted. */
export async function batchClientIds(user: TeamUser): Promise<string[] | null> {
  if (user.role === 'super_admin') return null
  if (user.role === 'general') return null
  if (user.role === 'client') return user.client_id ? [user.client_id] : []
  // an editor or scheduler sees only the shoots they are NAMED on (held via
  // heldBatchIds), never a client's whole list (the owner, 12 Sep 2026:
  // "shouldn't it be the ones they've tagged")
  if (user.role === 'editor' || user.role === 'scheduler') return []
  const rows = await table<TeamUserClient>('team_user_clients')
    .list({ by: { team_user_id: user.id } })
  return rows.map(r => r.client_id)
}

/**
 * THIS USER, AS THE SHOOT PAGE JUDGES THEM: the role and, for an account
 * manager, the clients they are on — so `canManageShoot` can say whether
 * the shoot page and its buttons are theirs. Editors, schedulers and crew
 * carry an empty list and manage nothing.
 */
export async function shootManager(user: TeamUser): Promise<SopManager> {
  const ids = await batchClientIds(user)
  return { id: user.id, role: user.role as SopManager['role'], clientIds: ids ?? undefined }
}

/** May this user work the shoot page for this shoot? */
export async function canManageBatch(user: TeamUser, batch: Pick<Batch, 'client_id' | 'owner_id' | 'created_by'>): Promise<boolean> {
  return canManageShoot(await shootManager(user), batch)
}

/** Assert this user may see this item at all; returns the item row. */
export async function loadItemForUser(user: TeamUser, itemId: string) {
  let item: ContentItem | null
  try {
    item = await table<ContentItem>('content_items').get(itemId)
  } catch (e) {
    throw new AuthzError(e instanceof Error ? e.message : 'Item not found', 500)
  }
  if (!item) throw new AuthzError('Item not found', 404)

  // the quality reviewer's desk: a card in the gate opens for them whoever's
  // client it is (the Team's Playbook, 11 Sep 2026)
  if (user.quality_reviewer === true && item.status === 'quality_check') {
    return item as ContentItem & Record<string, unknown> & {
      status: ItemStatus
      scheduler_ids?: string[] | null
      raw_assets?: { url: string; name: string }[] | null
    }
  }

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
  // the generated row types the free-form columns as `unknown`; every caller
  // has always read them as what they actually hold, so say so once here
  return item as ContentItem & Record<string, unknown> & {
    status: ItemStatus
    scheduler_ids?: string[] | null
    raw_assets?: { url: string; name: string }[] | null
  }
}

/**
 * The five ways involvement opens ONE item for someone off its client team.
 *
 * Held directly (owner, or handed the scheduling); tagged in a comment;
 * CREATED by them (the activity log is the only record of that — the board
 * lists what you made, so the click has to open it too); or
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
  const tag = await table<ItemComment>('item_comments').list({
    by: { item_id: item.id },
    where: r => r.assigned_to === user.id,
    limit: 1,
  })
  if (tag.length > 0) return true
  const made = await table<WorkflowActivity>('workflow_activity').list({
    where: a => a.entity_id === item.id && a.entity_type === 'content_item'
      && a.action === 'created' && a.actor_id === user.id,
    limit: 1,
  })
  if (made.length > 0) return true
  if (!item.batch_id) return false
  const batch = await table<Batch>('batches').get(item.batch_id)
  return batch ? await canOpenBatch(user, batch) : false
}

/**
 * The HAT-shaped serialization lives in `production-access-core.ts` — pure,
 * no `server-only`, no database — because the browser's live boards and the
 * item page must shape a row exactly as this API does. Re-exported here so
 * every server caller keeps importing it from where it always did.
 */
export { shapeItemDetail } from './production-access-core'
export type { ScopeViewer } from './production-access-core'
