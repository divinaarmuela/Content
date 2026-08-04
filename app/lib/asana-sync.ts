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
