import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { AsanaTask, AsanaEvent, AsanaProjectMap, AsanaWebhook, Client, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import { asanaConfigured } from '@/app/lib/asana'
import { rollupByPerson, rangeFromDays, dayKeyInTz, type RollupPerson } from '@/app/lib/asana-core'

/**
 * Team activity rollup.
 *
 * Authorization is the point of this route, not an afterthought — see
 * BUILD_PLAN §3.3. A super_admin sees everyone; every other team member sees
 * exactly their own row and nothing else. That filter is applied here, on the
 * server, before any data leaves: hiding rows in the UI would be presentation,
 * not a control. Clients never reach this at all (`scheduler` is the lowest
 * team role and `client` satisfies no team requirement).
 */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return withRequestCache(async () => {
  try {
    const me = await requireRole('scheduler')
    const isAdmin = me.role === 'super_admin'

    const url = new URL(req.url)
    // Open work does not depend on a window — only "completed" does — so the
    // range is a fixed sensible default rather than a control that mostly
    // changes nothing.
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 30) || 30, 1), 90)
    const type = url.searchParams.get('type')      // employee | contractor
    const clientId = url.searchParams.get('client')
    const now = new Date()
    const { from, to } = rangeFromDays(days, now)

    // Who this viewer is allowed to see.
    const peopleRows = await table<TeamUser>('team_users').list({
      by: { active_status: true },
      where: r => r.role !== 'client'
        && (isAdmin || r.id === me.id)
        && (type === 'employee' || type === 'contractor' ? r.employment_type === type : true),
      orderBy: [['name', 'asc']],
    })

    // the projection the old select named: the rollup is spread into the
    // response, so anything extra here would ship to the browser
    const people = peopleRows.map(r => ({
      id: r.id, name: r.name, email: r.email,
      employment_type: r.employment_type, timezone: r.timezone,
      asana_user_gid: r.asana_user_gid, role: r.role,
    })) as unknown as (RollupPerson & { role: string })[]
    const gids = people.map(p => p.asana_user_gid).filter((g): g is string => !!g)

    // No linked Asana identities yet — nothing to aggregate, but the page
    // still needs the people list so it can say so honestly.
    type TaskRow = {
      gid: string; name: string; assignee_gid: string | null; completed: boolean
      completed_at: string | null; due_on: string | null; permalink_url: string | null
      project_gid: string | null
    }
    let tasks: TaskRow[] = []
    let events: { user_gid: string | null; created_at: string }[] = []

    if (gids.length > 0) {
      const [taskRows, eventRows] = await Promise.all([
        table<AsanaTask>('asana_tasks').list({ where: t => !!t.assignee_gid && gids.includes(t.assignee_gid) }),
        table<AsanaEvent>('asana_events').list({
          where: e => !!e.user_gid && gids.includes(e.user_gid) && e.created_at >= from && e.created_at <= to,
        }),
      ])
      tasks = taskRows
      events = eventRows
    }

    // Project names so a task reads as "Website build — ALIA Fragrances"
    // rather than a bare gid, plus the client each project belongs to.
    const projectRows = await table<AsanaProjectMap>('asana_project_map').list()
    const projectName = new Map(projectRows.map(p => [p.project_gid, p.project_name]))

    // The client cut. Filtering the tasks *before* the rollup means the counts
    // recompute for that client rather than showing whole-workload figures
    // beside a filtered task list.
    if (clientId) {
      const inClient = new Set(
        projectRows.filter(p => p.client_id === clientId).map(p => p.project_gid)
      )
      tasks = tasks.filter(t => t.project_gid && inClient.has(t.project_gid))
    }

    const rollup = rollupByPerson({ people, tasks, events, from, to, now })

    // Clients that actually have tracked work — offering an empty filter is
    // worse than not offering it.
    const clientIds = [...new Set(projectRows.map(p => p.client_id).filter(Boolean))]
    const clientRows = clientIds.length
      ? (await table<Client>('clients').list({
          where: c => clientIds.includes(c.id), orderBy: [['name', 'asc']],
        })).map(c => ({ id: c.id, name: c.name }))
      : [] as { id: string; name: string }[]

    // The counts alone answer "how much"; the list answers "what". Open tasks
    // sort by due date with undated last, so what is late reads first.
    const rows = rollup.map(p => {
      const mine = tasks.filter(t => t.assignee_gid === p.asana_user_gid)
      const shape = (t: TaskRow) => ({
        gid: t.gid,
        name: t.name,
        due_on: t.due_on,
        url: t.permalink_url,
        project: t.project_gid ? projectName.get(t.project_gid) ?? null : null,
        overdue: !t.completed && !!t.due_on && t.due_on < dayKeyInTz(now, p.timezone),
      })
      return {
        ...p,
        tasks: {
          open: mine
            .filter(t => !t.completed)
            .sort((a, b) => (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999'))
            .slice(0, 50)
            .map(shape),
          done: mine
            .filter(t => t.completed && t.completed_at && t.completed_at >= from && t.completed_at <= to)
            .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
            .slice(0, 50)
            .map(shape),
        },
      }
    })

    // Connection health, so the page can explain itself rather than just
    // rendering zeroes. Admin-only: it names infrastructure.
    let connection: {
      configured: boolean
      trackedProjects: number
      liveWebhooks: number
      lastEventAt: string | null
    } | null = null

    if (isAdmin) {
      const [tracked, hooks] = await Promise.all([
        table<AsanaProjectMap>('asana_project_map').count({ by: { tracked: true } }),
        table<AsanaWebhook>('asana_webhooks').list(),
      ])
      const lastEventAt = hooks
        .map(h => h.last_event_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null
      connection = {
        configured: asanaConfigured(),
        trackedProjects: tracked ?? 0,
        liveWebhooks: hooks.filter(h => h.last_heartbeat_at).length,
        lastEventAt,
      }
    }

    return NextResponse.json({
      rows,
      range: { from, to, days },
      viewer: { id: me.id, isAdmin, timezone: me.timezone },
      clients: clientRows,
      connection,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
