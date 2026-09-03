import { NextResponse } from 'next/server'
import { table, encodeKey, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type {
  Batch, ContentItem, Lead, ScheduleEntry, TeamUserClient, UserPageAccess, WorkKind,
} from '@/lib/db-types'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../lib/authz'
import {
  accessibleClientIds, assertUuid, openTaggedIds, taggedBatchIds, taggedItemIds,
} from '../../lib/production-access'
import { visibleItems, type ScopeViewer } from '../../lib/scope-client'
import { buildOverview, type OverviewItem } from '../../lib/overview-core'

/**
 * One request, shaped to the caller's role — the data behind the Overview.
 *
 * Each role gets the slice of the business they act on (doc 1 §3): editors
 * their production work, schedulers the approved queue and what's going out,
 * managers the funnel plus leads. Everything is scoped through the same
 * accessibleClientIds gate the item list uses, so this endpoint can never
 * show someone a number their pages would refuse to explain.
 */

/** The shaping lives in `app/lib/overview-core.ts` — pure, and imported by
 *  the Overview PAGE too, which now draws these numbers from live database
 *  listeners. One definition of "Ready for review 3" for both. */
type ItemLite = OverviewItem

export async function GET() {
 return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)

    const clientIds = await accessibleClientIds(user)

    // Assignment grants visibility, the SAME rule as the items API and
    // loadItemForUser: owning the job, holding its scheduling, being tagged
    // on it, or holding the shoot it sits under. "Assigned to you" that
    // omits a job you were assigned is the whole complaint.
    //
    // There is one predicate, and it is `visibleItems` — the same call the items API
    // and the live boards make. `schedulerPostFilter: false` is deliberate
    // and is what the Overview PAGE passes too: this endpoint counts a
    // scheduler's whole scoped list and lets each card decide, so turning
    // the board's post-filter on here would quietly change every number.
    const viewer: ScopeViewer = {
      id: user.id,
      role: user.role,
      client_id: (user as { client_id?: string | null }).client_id ?? null,
    }
    let items: ItemLite[] = []
    try {
      const [assignments, batches, workKinds, itemTags, batchTags] = await Promise.all([
        clientIds === null
          ? Promise.resolve([] as TeamUserClient[])
          : table<TeamUserClient>('team_user_clients').list({ by: { team_user_id: user.id } }),
        table<Batch>('batches').list({ limit: 2000 }),
        table<WorkKind>('work_kinds').list(),
        taggedItemIds(user),
        taggedBatchIds(user),
      ])
      const all = await table<ContentItem>('content_items').list({
        orderBy: [['updated_at', 'desc']],
      })
      const rows = visibleItems(
        viewer,
        all as unknown as (ContentItem & { work_kinds?: null })[],
        assignments,
        {
          batches,
          taggedItemIds: itemTags,
          taggedBatchIds: batchTags,
          workKinds: workKinds as unknown as { id: string; slug: string }[],
          schedulerPostFilter: false,
        },
      ).slice(0, 500) as unknown as ContentItem[]
      items = await attachOne(
        await attachOne(rows, 'client_id', 'clients', ['name']),
        'work_kind_id', 'work_kinds', ['slug', 'uses_media'],
      ) as unknown as ItemLite[]
    } catch {
      // a fresh environment may hold no production rows at all — the overview
      // degrades to zeros rather than erroring the whole page
      items = []
    }

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

    // "someone tagged you and it is not done": the items (and shoots) with
    // an unresolved comment assigned to this person, whatever their role and
    // whether or not they are on the client. Every role's Overview shows it.
    const tagged = await openTaggedIds(user)
    // an item off the roster is still theirs to answer — fetch the ones the
    // scoped list above did not carry
    const missing = tagged.items.filter(id => !items.some(i => i.id === id)).map(assertUuid)
    let taggedExtraItems: ItemLite[] = []
    if (missing.length > 0) {
      taggedExtraItems = await table<ContentItem>('content_items')
        .list({ where: r => missing.includes(r.id) })
        .then(rows => attachOne(rows, 'client_id', 'clients', ['name']))
        .then(rows => rows as unknown as ItemLite[])
        .catch(() => [])
    }
    let taggedShoots: { id: string; title: string; client_id: string; clients: { name: string } | null }[] = []
    if (tagged.batches.length > 0) {
      const shootIds = tagged.batches.map(assertUuid)
      taggedShoots = await table<Batch>('batches')
        .list({ where: r => shootIds.includes(r.id) })
        .then(rows => attachOne(rows, 'client_id', 'clients', ['name']))
        .then(rows => rows as unknown as typeof taggedShoots)
        .catch(() => [])
    }

    // the scheduler's two panels read the posting calendar. Lower-bounded:
    // without this, 200 historical rows fill the window and both panels go
    // permanently blank on a busy account.
    let entries: Record<string, unknown>[] = []
    if (user.role === 'scheduler') {
      const entryRows = await table<ScheduleEntry>('schedule_entries').list({
        where: r => r.scheduled_at != null && r.scheduled_at >= weekAgo,
        orderBy: [['scheduled_at', 'asc']],
        limit: 200,
      }).catch(() => [])
      // the item, and nested inside it its client's name and posting zone —
      // the shape the dashboard reads (e.content_items.clients.timezone)
      const withItems = await attachOne(entryRows, 'item_id', 'content_items', ['id', 'title', 'client_id'])
      const clientsById = new Map(
        (await table('clients').list().catch(() => []))
          .map(c => [c.id, { name: c.name, timezone: c.timezone }]),
      )
      entries = withItems.map(e => ({
        ...e,
        content_items: e.content_items
          ? { ...e.content_items, clients: clientsById.get(e.content_items.client_id as string) ?? null }
          : null,
      }))
    }

    // Lead data only for those who may see the Leads page: supers by role,
    // an AM only via an explicit per-person grant.
    // the row's id IS (team_user_id, href) — one grant per person per page
    let mayLeads = false
    let leads: Lead[] = []
    let clientCount = 0
    if (user.role !== 'editor' && user.role !== 'scheduler') {
      const leadsRow = await table<UserPageAccess & { hidden?: boolean }>('user_page_access')
        .get(`${user.id}__${encodeKey('/dashboard/leads')}`)
        .catch(() => null)
      // hidden wins for everyone — a super admin who muted Leads sees none of it
      mayLeads = !leadsRow?.hidden
        && (user.role === 'super_admin' || (!!leadsRow && !leadsRow.hidden))
      const [clientRows, leadRows] = await Promise.all([
        // an empty id list scopes to nothing on its own — no sentinel needed
        table('clients').list({
          where: clientIds === null ? undefined : r => clientIds.includes(r.id),
          orderBy: [['name', 'asc']],
        }).catch(() => []),
        mayLeads
          ? table<Lead>('leads').list({ orderBy: [['created_at', 'desc']], limit: 50 }).catch(() => [])
          : Promise.resolve([] as Lead[]),
      ])
      clientCount = clientRows.length
      leads = leadRows
    }

    return NextResponse.json(buildOverview({
      user: { id: user.id, role: user.role, name: user.name },
      items,
      tagged,
      taggedExtraItems,
      taggedShoots,
      clientCount,
      entries: entries as never,
      leads,
      mayLeads,
    }))
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
 })
}
