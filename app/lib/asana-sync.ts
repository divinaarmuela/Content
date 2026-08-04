import 'server-only'
import { supabase } from '@/lib/supabase'
import * as asana from './asana'
import { normalizeBatch, webhookLooksDead, type RawAsanaEvent } from './asana-core'

/**
 * Reconciliation: the second of the two ingestion paths.
 *
 * Asana's webhook delivery is *at-most-once* and the /events history is only
 * 24 hours, so webhooks alone will silently lose data. This poll backfills the
 * gaps and detects webhooks Asana has self-deleted.
 *
 * Deliberately callable on its own (a "Sync now" button) as well as from a
 * cron. Inngest is not configured on this deployment yet, and an integration
 * that only works once a background scheduler exists is an integration nobody
 * can try.
 */

export type SyncResult = {
  projects: number
  newEvents: number
  tasksMirrored: number
  baselined: string[]
  deadWebhooks: string[]
  errors: { project: string; message: string }[]
}

/** Poll one project: backfill missed events, then mirror the tasks involved. */
async function syncProject(projectGid: string, result: SyncResult): Promise<void> {
  const { data: hook } = await supabase
    .from('asana_webhooks')
    .select('sync_token,last_heartbeat_at,webhook_gid')
    .eq('project_gid', projectGid)
    .maybeSingle()

  // ── Events ──
  const page = await asana.pollEvents(projectGid, hook?.sync_token)

  if (page.baselined) {
    // 412 with a fresh token: this is the documented way to establish a
    // baseline, not a failure. There is nothing to insert on this pass.
    result.baselined.push(projectGid)
  } else if (page.events.length > 0) {
    const rows = normalizeBatch(page.events as RawAsanaEvent[], {
      projectGid,
      source: 'poll',
    })
    if (rows.length > 0) {
      // The dedup_key unique constraint absorbs anything the webhook already
      // delivered, so the overlap is free.
      const { data: inserted, error } = await supabase
        .from('asana_events')
        .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      result.newEvents += inserted?.length ?? 0
    }
  }

  await supabase.from('asana_webhooks').upsert(
    { project_gid: projectGid, sync_token: page.sync || null, last_error: null },
    { onConflict: 'project_gid' }
  )

  // ── Task mirror ──
  // Events say a field changed, never what it changed to. "Open" and
  // "overdue" are statements about present state, so they need the tasks
  // themselves.
  const tasks = await asana.tasksForProject(projectGid)
  if (tasks.length > 0) {
    const { error } = await supabase.from('asana_tasks').upsert(
      tasks.map(t => ({
        gid: t.gid,
        name: t.name ?? '',
        assignee_gid: t.assignee?.gid ?? null,
        project_gid: projectGid,
        completed: !!t.completed,
        completed_at: t.completed_at,
        due_on: t.due_on,
        modified_at: t.modified_at,
        permalink_url: t.permalink_url ?? null,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: 'gid' }
    )
    if (error) throw new Error(error.message)
    result.tasksMirrored += tasks.length
  }

  // ── Webhook health ──
  // A self-deleted webhook is indistinguishable from a quiet one except by
  // its missing heartbeat, so silence past the grace window means re-register.
  if (hook && webhookLooksDead(hook.last_heartbeat_at, new Date())) {
    result.deadWebhooks.push(projectGid)
  }
}

/** Reconcile every tracked project. One project's failure never stops the rest. */
export async function reconcileAll(): Promise<SyncResult> {
  const result: SyncResult = {
    projects: 0, newEvents: 0, tasksMirrored: 0,
    baselined: [], deadWebhooks: [], errors: [],
  }

  if (!asana.asanaConfigured()) {
    result.errors.push({ project: '—', message: 'ASANA_PAT is not set' })
    return result
  }

  const { data: tracked } = await supabase
    .from('asana_project_map')
    .select('project_gid')
    .eq('tracked', true)

  for (const row of tracked ?? []) {
    result.projects++
    try {
      await syncProject(row.project_gid, result)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      result.errors.push({ project: row.project_gid, message })
      await supabase
        .from('asana_webhooks')
        .upsert({ project_gid: row.project_gid, last_error: message }, { onConflict: 'project_gid' })
    }
  }

  return result
}

/**
 * Pull tasks by assignee rather than by project.
 *
 * Walking projects misses two whole categories: tasks in no project at all,
 * and tasks in projects nobody thought to track. On this workspace that was
 * most of a person's real workload — 7 of 8 tasks invisible. Since the rollup
 * is per person, asking Asana per person is the query that actually matches
 * the question.
 *
 * `completed_since` returns everything still open plus anything completed
 * after that instant, which is exactly the window the rollup reports on.
 */
export async function syncTasksForAssignees(
  workspaceGid: string,
  days = 30
): Promise<{ people: number; tasks: number }> {
  const { data: people } = await supabase
    .from('team_users')
    .select('asana_user_gid')
    .not('asana_user_gid', 'is', null)
    .eq('active_status', true)

  const gids = [...new Set((people ?? []).map(p => p.asana_user_gid as string))]
  if (gids.length === 0) return { people: 0, tasks: 0 }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  let total = 0

  for (const gid of gids) {
    const tasks = await asana.tasksForAssignee(gid, workspaceGid, since)
    if (tasks.length === 0) continue

    const { error } = await supabase.from('asana_tasks').upsert(
      tasks.map(t => ({
        gid: t.gid,
        name: t.name ?? '',
        assignee_gid: gid,
        // a task can belong to several projects, or none — keep the first for
        // grouping and never drop the task for lacking one
        project_gid: t.projects?.[0]?.gid ?? null,
        completed: !!t.completed,
        completed_at: t.completed_at,
        due_on: t.due_on,
        modified_at: t.modified_at,
        permalink_url: t.permalink_url ?? null,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: 'gid' }
    )
    if (error) throw new Error(error.message)
    total += tasks.length
  }

  return { people: gids.length, tasks: total }
}

/**
 * Create a team_users row for every Asana person, so the rollup has someone
 * to attribute work to without onboarding the whole team by hand first.
 *
 * Importantly this does NOT grant anyone access: sign-in still resolves by
 * clerk_user_id and still requires an invite (app/lib/authz), so these rows
 * are tracking records until a real invitation is accepted. Existing rows keep
 * their role and employment type — only the Asana link is filled in.
 *
 * Employment type defaults by email domain, which is a guess an admin can
 * correct in Settings → Team; it is never inferred again after the first
 * import.
 */
export async function importAsanaPeople(
  workspaceGid: string,
  agencyDomain = 'mdmmarketing.com.au'
): Promise<{ created: number; linked: number; skipped: number }> {
  const asanaUsers = (await asana.listUsers(workspaceGid)).filter(u => u.email)

  const { data: existingRows } = await supabase
    .from('team_users')
    .select('id,email,asana_user_gid')
  const existing = new Map((existingRows ?? []).map(r => [r.email.toLowerCase(), r]))

  let created = 0, linked = 0, skipped = 0

  for (const u of asanaUsers) {
    const email = u.email!.toLowerCase()
    const row = existing.get(email)

    if (row) {
      if (row.asana_user_gid !== u.gid) {
        const { error } = await supabase
          .from('team_users')
          .update({ asana_user_gid: u.gid })
          .eq('id', row.id)
        if (!error) linked++
        else skipped++
      } else skipped++
      continue
    }

    const { error } = await supabase.from('team_users').insert({
      email,
      name: u.name ?? email,
      role: 'editor',
      employment_type: email.endsWith('@' + agencyDomain) ? 'employee' : 'contractor',
      asana_user_gid: u.gid,
    })
    if (error) skipped++
    else created++
  }

  return { created, linked, skipped }
}

/**
 * One-shot connect: everything the old Track / Go live / Sync now sequence did,
 * in the order that makes it work first time.
 *
 * The old flow made three separate clicks mandatory and gave no hint that
 * "Go live" only subscribes to *future* changes — so webhooks registered fine
 * while the page stayed empty, which read as a broken integration.
 */
export async function connectAsana(workspaceGid: string, appUrl: string | null): Promise<{
  people: { created: number; linked: number }
  projects: number
  webhooks: { registered: number; failed: number }
  tasks: number
  errors: { project: string; message: string }[]
}> {
  const errors: { project: string; message: string }[] = []

  // 1. people first — tasks are attributed to them
  const people = await importAsanaPeople(workspaceGid)

  // 2. track every visible project
  const projects = await asana.listProjects(workspaceGid)
  if (projects.length > 0) {
    await supabase.from('asana_project_map').upsert(
      projects.map(p => ({ project_gid: p.gid, project_name: p.name ?? '', tracked: true })),
      { onConflict: 'project_gid' }
    )
  }

  // 3. webhooks for live updates, best-effort — a failure here costs freshness,
  //    not data, because the poll still covers every tracked project
  let registered = 0, failed = 0
  if (appUrl) {
    const { data: hooks } = await supabase.from('asana_webhooks').select('project_gid,webhook_gid')
    const live = new Set((hooks ?? []).filter(h => h.webhook_gid).map(h => h.project_gid))

    for (const p of projects) {
      if (live.has(p.gid)) continue
      try {
        const target = `${appUrl.replace(/\/$/, '')}/api/asana/webhook?project=${p.gid}`
        const hook = await asana.createWebhook(p.gid, target)
        await supabase
          .from('asana_webhooks')
          .upsert({ project_gid: p.gid, webhook_gid: hook.gid }, { onConflict: 'project_gid' })
        registered++
      } catch (e) {
        failed++
        errors.push({ project: p.name ?? p.gid, message: e instanceof Error ? e.message : 'failed' })
      }
    }
  }

  // 4. pull the tasks — by assignee, so nothing is missed for lacking a project
  const byAssignee = await syncTasksForAssignees(workspaceGid)

  // 5. and baseline the event streams
  const recon = await reconcileAll()
  errors.push(...recon.errors)

  return {
    people: { created: people.created, linked: people.linked },
    projects: projects.length,
    webhooks: { registered, failed },
    tasks: byAssignee.tasks,
    errors,
  }
}

/**
 * Match Asana users to team_users by email and stamp `asana_user_gid`.
 *
 * Email is the only identifier the two systems share. Anyone who does not
 * match is reported back rather than guessed at — a wrong mapping would
 * attribute one person's work to another, which is precisely the failure this
 * dashboard cannot afford.
 */
export async function linkUsersByEmail(workspaceGid: string): Promise<{
  linked: { email: string; gid: string }[]
  unmatched: string[]
}> {
  const asanaUsers = await asana.listUsers(workspaceGid)
  const byEmail = new Map(
    asanaUsers.filter(u => u.email).map(u => [u.email!.toLowerCase(), u.gid])
  )

  const { data: team } = await supabase
    .from('team_users')
    .select('id,email,asana_user_gid')
    .eq('active_status', true)
    .neq('role', 'client')

  const linked: { email: string; gid: string }[] = []
  const unmatched: string[] = []

  for (const member of team ?? []) {
    const gid = byEmail.get(member.email.toLowerCase())
    if (!gid) {
      if (!member.asana_user_gid) unmatched.push(member.email)
      continue
    }
    if (member.asana_user_gid === gid) continue
    const { error } = await supabase
      .from('team_users')
      .update({ asana_user_gid: gid })
      .eq('id', member.id)
    if (!error) linked.push({ email: member.email, gid })
  }

  return { linked, unmatched }
}
