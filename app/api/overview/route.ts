import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../lib/authz'
import { accessibleClientIds } from '../../lib/production-access'
import { ITEM_STATUSES } from '../../lib/workflow-core'

/**
 * One request, shaped to the caller's role — the data behind the Overview.
 *
 * Each role gets the slice of the business they act on (doc 1 §3): editors
 * their production work, schedulers the approved queue and what's going out,
 * managers the funnel plus leads. Everything is scoped through the same
 * accessibleClientIds gate the item list uses, so this endpoint can never
 * show someone a number their pages would refuse to explain.
 */

type ItemLite = {
  id: string
  title: string
  status: string
  content_type: string
  priority: string
  due_date: string | null
  scheduler_ids?: unknown
  client_id: string
  owner_id: string | null
  updated_at: string
  clients: { name: string } | null
}

export async function GET() {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)

    const clientIds = await accessibleClientIds(user)

    let itemsQ = supabase
      .from('content_items')
      .select('id, title, status, content_type, priority, due_date, client_id, owner_id, scheduler_ids, updated_at, clients(name)')
      .order('updated_at', { ascending: false })
      .limit(500)
    if (clientIds !== null) {
      // ownership grants visibility, same rule as the items API
      itemsQ = clientIds.length === 0
        ? itemsQ.eq('owner_id', user.id)
        : itemsQ.or(`client_id.in.(${clientIds.join(',')}),owner_id.eq.${user.id}`)
    }
    const { data: itemRows, error: itemsErr } = await itemsQ
    // the production tables may not exist yet in a fresh environment — the
    // overview should degrade to zeros, not error the whole page
    const items: ItemLite[] = itemsErr ? [] : ((itemRows ?? []) as unknown as ItemLite[])

    const pipeline: Record<string, number> = Object.fromEntries(ITEM_STATUSES.map(s => [s, 0]))
    for (const i of items) if (pipeline[i.status] !== undefined) pipeline[i.status] += 1

    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
    const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString()

    if (user.role === 'editor') {
      const mine = items.filter(i => i.owner_id === user.id)
      const pool = mine.length > 0 ? mine : items // editors on shared boards still get a picture
      const needsAction = pool
        .filter(i => ['revision_required', 'draft_uploaded', 'revision_complete'].includes(i.status))
        .sort((a, b) => (a.status === 'revision_required' ? -1 : 1) - (b.status === 'revision_required' ? -1 : 1))
        .slice(0, 8)
      const dueSoon = pool
        .filter(i => i.due_date && i.due_date <= weekAhead.slice(0, 10) && !['published', 'scheduled'].includes(i.status))
        .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''))
        .slice(0, 8)
      return NextResponse.json({
        role: user.role,
        name: user.name,
        pipeline,
        editor: {
          my_items: mine.length,
          in_internal_review: pool.filter(i => i.status === 'internal_review').length,
          revisions_needed: pool.filter(i => i.status === 'revision_required').length,
          needs_action: needsAction,
          due_soon: dueSoon,
        },
      })
    }

    if (user.role === 'scheduler') {
      // their queue, the way an editor's board is their jobs: items handed to
      // them, plus unassigned ones so nothing approved can go invisible
      const queue = items.filter(i => {
        if (i.status !== 'approved_for_scheduling') return false
        const assigned = Array.isArray(i.scheduler_ids) ? i.scheduler_ids : []
        return assigned.length === 0 || assigned.includes(user.id)
      })
      let upcoming: unknown[] = []
      let publishedWeek = 0
      const { data: entries } = await supabase
        .from('schedule_entries')
        .select('id, item_id, platform, scheduled_at, live_url, published_at, content_items(id, title, client_id, clients(name))')
        // lower-bounded: without this, 200 historical rows fill the window
        // and both panels go permanently blank on a busy account
        .gte('scheduled_at', weekAgo)
        .order('scheduled_at', { ascending: true })
        .limit(200)
      if (entries) {
        const now = new Date().toISOString()
        upcoming = entries
          .filter(e => e.scheduled_at && e.scheduled_at >= now && e.scheduled_at <= weekAhead)
          .slice(0, 8)
        publishedWeek = entries.filter(e => e.published_at && e.published_at >= weekAgo).length
      }
      return NextResponse.json({
        role: user.role,
        name: user.name,
        pipeline,
        scheduler: {
          to_schedule: queue.length,
          queue: queue.slice(0, 8),
          upcoming,
          published_week: publishedWeek,
        },
      })
    }

    // account_manager / super_admin — the funnel plus the front door.
    // Lead data only for those who may see the Leads page: supers by role,
    // an AM only via an explicit per-person grant.
    const { data: leadsRow } = await supabase.from('user_page_access')
      .select('hidden').eq('team_user_id', user.id).eq('href', '/dashboard/leads').maybeSingle()
    // hidden wins for everyone — a super admin who muted Leads sees none of it
    const mayLeads = !leadsRow?.hidden
      && (user.role === 'super_admin' || (!!leadsRow && !leadsRow.hidden))
    let clientsQ = supabase.from('clients').select('id, name').order('name')
    if (clientIds !== null) clientsQ = clientsQ.in('id', clientIds.length ? clientIds : ['00000000-0000-0000-0000-000000000000'])
    const [{ data: clientRows }, { data: leadRows }] = await Promise.all([
      clientsQ,
      mayLeads
        ? supabase.from('leads')
            .select('id, fname, lname, biz, source, created_at')
            .order('created_at', { ascending: false })
            .limit(50)
        : Promise.resolve({ data: null }),
    ])
    const leads = leadRows ?? []
    const needsReview = items
      .filter(i => ['internal_review', 'client_review', 'client_changes_requested'].includes(i.status))
      .slice(0, 8)
    return NextResponse.json({
      role: user.role,
      name: user.name,
      pipeline,
      manager: {
        clients: (clientRows ?? []).length,
        awaiting_internal_review: pipeline.internal_review ?? 0,
        awaiting_client: (pipeline.client_review ?? 0) + (pipeline.client_changes_requested ?? 0),
        revisions_open: pipeline.revision_required ?? 0,
        needs_review: needsReview,
        ...(mayLeads
          ? {
              leads_total: leads.length,
              leads_week: leads.filter(l => l.created_at >= weekAgo).length,
              latest_leads: leads.slice(0, 6),
            }
          : {}),
      },
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
