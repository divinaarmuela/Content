import 'server-only'
import { retryAfterMs } from './asana-core'

/**
 * Asana REST client. Auth is a plain bearer PAT belonging to a dedicated
 * service account that has been added to every tracked project.
 *
 * Note the env var is read lazily inside the functions, not at module load.
 * Reading at load turns a missing var into a *build* failure rather than a
 * request failure (CLAUDE.md trap 7) — Asana is an optional integration, so
 * it must degrade to "not configured" instead of taking the whole app down.
 */

const BASE = 'https://app.asana.com/api/1.0'

export function asanaConfigured(): boolean {
  return !!process.env.ASANA_PAT
}

export class AsanaError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

type Json = Record<string, unknown>

/**
 * One request, with the documented 429 handling: honour `Retry-After` rather
 * than retrying blind, because rejected requests still burn quota. Paid plan
 * gives 1,500 req/min, so at our scale this is a safety net, not a bottleneck.
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  attempt = 0
): Promise<T> {
  const pat = process.env.ASANA_PAT
  if (!pat) throw new AsanaError('ASANA_PAT is not set', 503)

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  })

  if (res.status === 429 && attempt < 3) {
    await new Promise(r => setTimeout(r, retryAfterMs(res.headers.get('retry-after'))))
    return request<T>(path, init, attempt + 1)
  }

  const text = await res.text()
  let body: { data?: T; errors?: { message?: string }[]; sync?: string } = {}
  try { body = text ? JSON.parse(text) : {} } catch { /* Asana error pages are not JSON */ }

  if (!res.ok) {
    const message = body.errors?.[0]?.message ?? `Asana ${res.status}`
    throw new AsanaError(message, res.status)
  }
  return body.data as T
}

// ─── Workspace / people ───

export type AsanaUser = { gid: string; name: string; email?: string }

export async function listWorkspaces(): Promise<{ gid: string; name: string }[]> {
  return request('/workspaces')
}

/** Used to map team_users.asana_user_gid by email. */
export async function listUsers(workspaceGid: string): Promise<AsanaUser[]> {
  return request(`/users?workspace=${workspaceGid}&opt_fields=name,email`)
}

export type AsanaProject = { gid: string; name: string; archived?: boolean }

export async function listProjects(workspaceGid: string): Promise<AsanaProject[]> {
  return request(`/projects?workspace=${workspaceGid}&archived=false&opt_fields=name,archived&limit=100`)
}

// ─── Tasks ───

export type AsanaTask = {
  gid: string
  name: string
  completed: boolean
  completed_at: string | null
  due_on: string | null
  modified_at: string | null
  permalink_url?: string
  assignee?: { gid: string } | null
  projects?: { gid: string; name?: string }[]
}

// An explicit opt_fields allowlist, not a deep expansion — Asana also applies
// cost-based rate limiting, and wide payloads are what trips it.
const TASK_FIELDS = 'name,completed,completed_at,due_on,modified_at,permalink_url,assignee.gid'

export async function tasksForProject(projectGid: string, modifiedSince?: string): Promise<AsanaTask[]> {
  const since = modifiedSince ? `&modified_since=${encodeURIComponent(modifiedSince)}` : ''
  return request(`/tasks?project=${projectGid}&opt_fields=${TASK_FIELDS}&limit=100${since}`)
}

export async function getTask(taskGid: string): Promise<AsanaTask> {
  return request(`/tasks/${taskGid}?opt_fields=${TASK_FIELDS}`)
}

/**
 * One person's tasks across the whole workspace.
 *
 * `completed_since` is the useful filter here: Asana returns everything still
 * incomplete plus anything completed after that instant. Without it the call
 * returns the person's entire history.
 *
 * This is the only way to see tasks that belong to no project — the
 * project-walk cannot reach them by definition.
 */
export async function tasksForAssignee(
  assigneeGid: string,
  workspaceGid: string,
  completedSince: string
): Promise<AsanaTask[]> {
  return request(
    `/tasks?assignee=${assigneeGid}&workspace=${workspaceGid}` +
    `&completed_since=${encodeURIComponent(completedSince)}` +
    `&opt_fields=${TASK_FIELDS},projects.gid,projects.name&limit=100`
  )
}

// ─── Webhooks ───

export type AsanaWebhook = { gid: string; resource: { gid: string }; active: boolean }

export async function listWebhooks(workspaceGid: string): Promise<AsanaWebhook[]> {
  return request(`/webhooks?workspace=${workspaceGid}&opt_fields=resource,active`)
}

/**
 * Register a webhook.
 *
 * This call *blocks* until our receiver has echoed the X-Hook-Secret header
 * back, so the route must already be deployed and publicly reachable. A
 * timeout here almost always means the receiver is not live at `target`, not
 * that the payload is wrong.
 */
export async function createWebhook(resourceGid: string, target: string): Promise<AsanaWebhook> {
  return request('/webhooks', {
    method: 'POST',
    body: JSON.stringify({ data: { resource: resourceGid, target } }),
  })
}

export async function deleteWebhook(webhookGid: string): Promise<void> {
  await request(`/webhooks/${webhookGid}`, { method: 'DELETE' })
}

// ─── Events (reconciliation) ───

export type EventsPage = { events: Json[]; sync: string; baselined: boolean }

/**
 * Poll the event stream for a resource.
 *
 * A first-ever call, or an expired token, answers **412 Precondition Failed**
 * with a fresh sync token in the body. That is the documented way to get a
 * baseline — it is not an error, and treating it as one is the classic way to
 * get stuck never syncing.
 */
export async function pollEvents(resourceGid: string, syncToken?: string | null): Promise<EventsPage> {
  const pat = process.env.ASANA_PAT
  if (!pat) throw new AsanaError('ASANA_PAT is not set', 503)

  const qs = `resource=${resourceGid}${syncToken ? `&sync=${encodeURIComponent(syncToken)}` : ''}`
  const res = await fetch(`${BASE}/events?${qs}`, {
    headers: { Authorization: `Bearer ${pat}` },
    cache: 'no-store',
  })
  const body = await res.json().catch(() => ({})) as {
    data?: Json[]; sync?: string; errors?: { message?: string }[]
  }

  if (res.status === 412) {
    return { events: [], sync: body.sync ?? '', baselined: true }
  }
  if (!res.ok) {
    throw new AsanaError(body.errors?.[0]?.message ?? `Asana ${res.status}`, res.status)
  }
  return { events: body.data ?? [], sync: body.sync ?? syncToken ?? '', baselined: false }
}
