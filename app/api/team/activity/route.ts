import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
  try {
    const me = await requireRole('scheduler')
    const isAdmin = me.role === 'super_admin'

    const url = new URL(req.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? 7) || 7, 1), 90)
    const now = new Date()
    const { from, to } = rangeFromDays(days, now)

    // Who this viewer is allowed to see.
    let peopleQuery = supabase
      .from('team_users')
      .select('id,name,email,employment_type,timezone,asana_user_gid,role')
      .eq('active_status', true)
      .neq('role', 'client')
      .order('name')

    if (!isAdmin) peopleQuery = peopleQuery.eq('id', me.id)

    const { data: peopleRows, error: peopleError } = await peopleQuery
    if (peopleError) throw new Error(peopleError.message)

    const people = (peopleRows ?? []) as (RollupPerson & { role: string })[]
    const gids = people.map(p => p.asana_user_gid).filter((g): g is string => !!g)

    // No linked Asana identities yet → nothing to aggregate, but the page
    // still needs the people list so it can say so honestly.
    type TaskRow = {
      gid: string; name: string; assignee_gid: string | null; completed: boolean
      completed_at: string | null; due_on: string | null; permalink_url: string | null
      project_gid: string | null
    }
    let tasks: TaskRow[] = []
    let events: { user_gid: string | null; created_at: string }[] = []

    if (gids.length > 0) {
      const [taskRes, eventRes] = await Promise.all([
        supabase
          .from('asana_tasks')
          .select('gid,name,assignee_gid,completed,completed_at,due_on,permalink_url,project_gid')
          .in('assignee_gid', gids),
        supabase
          .from('asana_events')
          .select('user_gid,created_at')
          .in('user_gid', gids)
          .gte('created_at', from)
          .lte('created_at', to),
      ])
      if (taskRes.error) throw new Error(taskRes.error.message)
      if (eventRes.error) throw new Error(eventRes.error.message)
      tasks = taskRes.data ?? []
      events = eventRes.data ?? []
    }

    const rollup = rollupByPerson({ people, tasks, events, from, to, now })

    // Project names so a task reads as "Website build — ALIA Fragrances"
    // rather than a bare gid.
    const { data: projectRows } = await supabase
      .from('asana_project_map')
      .select('project_gid,project_name')
    const projectName = new Map((projectRows ?? []).map(p => [p.project_gid, p.project_name]))

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
      const [{ count: tracked }, { data: hooks }] = await Promise.all([
        supabase.from('asana_project_map').select('project_gid', { count: 'exact', head: true }).eq('tracked', true),
        supabase.from('asana_webhooks').select('last_heartbeat_at,last_event_at'),
      ])
      const lastEventAt = (hooks ?? [])
        .map(h => h.last_event_at)
        .filter(Boolean)
        .sort()
        .pop() ?? null
      connection = {
        configured: asanaConfigured(),
        trackedProjects: tracked ?? 0,
        liveWebhooks: (hooks ?? []).filter(h => h.last_heartbeat_at).length,
        lastEventAt,
      }
    }

    return NextResponse.json({
      rows,
      range: { from, to, days },
      viewer: { id: me.id, isAdmin, timezone: me.timezone },
      connection,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
