import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { table, withRequestCache } from '@/lib/db'
import type { AsanaProjectMap, AsanaWebhook, TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import * as asana from '@/app/lib/asana'
import { reconcileAll, linkUsersByEmail, connectAsana, syncTasksForAssignees } from '@/app/lib/asana-sync'

/**
 * Asana connection admin — super_admin only.
 *
 * Everything here names or mutates infrastructure (tokens, webhooks, which
 * projects are watched), so it sits above the rollup's `scheduler` gate.
 */

export const dynamic = 'force-dynamic'

/**
 * Resolve the URL Asana should actually call.
 *
 * NEXT_PUBLIC_APP_URL is configuration, and configuration drifts: the bare
 * apex domain 308-redirects to www on this deployment, and Asana's handshake
 * POST would land on the redirect rather than the receiver. Registration would
 * then fail with a timeout that says nothing about the cause.
 *
 * So we follow redirects ourselves first and register the final URL. The probe
 * carries no X-Hook-Secret, so it takes the delivery branch and is rejected as
 * an unknown webhook — it writes nothing and cannot clobber a stored secret.
 */
/** The canonical origin, once, so bulk registration does not re-probe per project. */
async function resolveBase(base: string): Promise<string> {
  const probe = await resolveTarget(base, 'probe')
  return probe.replace(/\/api\/asana\/webhook\?project=probe$/, '')
}

async function resolveTarget(base: string, projectGid: string): Promise<string> {
  let url = `${base.replace(/\/$/, '')}/api/asana/webhook?project=${projectGid}`

  for (let hop = 0; hop < 3; hop++) {
    let res: Response
    try {
      res = await fetch(url, { method: 'POST', redirect: 'manual', body: '{}' })
    } catch {
      return url // unreachable from here; let Asana report the real failure
    }
    if (res.status < 300 || res.status >= 400) return url
    const location = res.headers.get('location')
    if (!location) return url
    url = new URL(location, url).toString()
  }
  return url
}

/** Connection state for the setup panel. */
export async function GET() {
  return withRequestCache(async () => {
  try {
    await requireRole('super_admin')

    const configured = asana.asanaConfigured()
    const workspaceGid = process.env.ASANA_WORKSPACE_GID ?? null

    const [mapped, hooks, teamRows] = await Promise.all([
      table<AsanaProjectMap>('asana_project_map').list({ orderBy: [['project_name', 'asc']] }),
      table<AsanaWebhook>('asana_webhooks').list(),
      table<TeamUser>('team_users').list({
        by: { active_status: true },
        where: r => r.role !== 'client',
        orderBy: [['name', 'asc']],
      }),
    ])
    // the projection the old select named — the panel needs four fields, not
    // everything the team row carries
    const team = teamRows.map(r => ({
      id: r.id, name: r.name, email: r.email, asana_user_gid: r.asana_user_gid,
    }))

    // Only reach out to Asana when we actually can — an unconfigured install
    // should render a setup screen, not an error.
    let projects: { gid: string; name: string }[] = []
    let reachable = false
    let reachError: string | null = null
    if (configured && workspaceGid) {
      try {
        projects = await asana.listProjects(workspaceGid)
        reachable = true
      } catch (e) {
        reachError = e instanceof Error ? e.message : 'Could not reach Asana'
      }
    }

    return NextResponse.json({
      configured,
      workspaceGid,
      reachable,
      reachError,
      projects,
      mapped,
      webhooks: hooks,
      team,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    await requireRole('super_admin')
    const body = await req.json().catch(() => ({})) as {
      action?: string
      projectGid?: string
      projectName?: string
      clientId?: string | null
      tracked?: boolean
    }

    const workspaceGid = process.env.ASANA_WORKSPACE_GID

    switch (body.action) {
      // ── Track / untrack a project ──
      case 'track': {
        if (!body.projectGid) return NextResponse.json({ error: 'projectGid required' }, { status: 400 })
        await table<AsanaProjectMap>('asana_project_map').upsert(
          {
            project_gid: body.projectGid,
            project_name: body.projectName ?? '',
            client_id: body.clientId ?? null,
            tracked: body.tracked ?? true,
          },
          { onConflict: 'project_gid' }
        )
        return NextResponse.json({ ok: true })
      }

      // ── Register the webhook for a project ──
      // The create call blocks until our receiver echoes X-Hook-Secret, so
      // this only works against a deployed, publicly reachable URL.
      case 'register': {
        if (!body.projectGid) return NextResponse.json({ error: 'projectGid required' }, { status: 400 })
        const base = process.env.NEXT_PUBLIC_APP_URL
        if (!base) {
          return NextResponse.json(
            { error: 'NEXT_PUBLIC_APP_URL must be set — Asana needs a public URL to call back.' },
            { status: 400 }
          )
        }
        const target = await resolveTarget(base, body.projectGid)
        try {
          const hook = await asana.createWebhook(body.projectGid, target)
          // one row per project: the table's key is its own uuid, so the
          // "one row per project_gid" rule is applied here
          const webhooks = table<AsanaWebhook>('asana_webhooks')
          const existing = (await webhooks.list({ where: h => h.project_gid === body.projectGid, limit: 1 }))[0]
          if (existing) await webhooks.update(existing.id, { webhook_gid: hook.gid })
          else await table('asana_webhooks').insert({ id: randomUUID(), project_gid: body.projectGid, webhook_gid: hook.gid })
          return NextResponse.json({ ok: true, webhookGid: hook.gid })
        } catch (e) {
          return NextResponse.json(
            {
              error: e instanceof Error ? e.message : 'Registration failed',
              hint: `Asana holds this request open until ${target} echoes the handshake. Confirm that URL is deployed and public.`,
            },
            { status: 502 }
          )
        }
      }

      // ── Match Asana people to team members by email ──
      case 'link-users': {
        if (!workspaceGid) return NextResponse.json({ error: 'ASANA_WORKSPACE_GID is not set' }, { status: 400 })
        return NextResponse.json(await linkUsersByEmail(workspaceGid))
      }

      // ── Poll now (works with or without Inngest) ──
      case 'sync': {
        if (!workspaceGid) return NextResponse.json({ error: 'ASANA_WORKSPACE_GID is not set' }, { status: 400 })
        const [recon, byAssignee] = await Promise.all([
          reconcileAll(),
          syncTasksForAssignees(workspaceGid),
        ])
        return NextResponse.json({ ...recon, tasksMirrored: recon.tasksMirrored + byAssignee.tasks })
      }

      // ── One-shot connect ──
      // Import people, track every project, register webhooks, pull tasks and
      // baseline the event streams. The previous Track / Go live / Sync now
      // sequence required three clicks in an order nothing communicated, and
      // stopping after the second left webhooks live but the page empty.
      case 'connect': {
        if (!workspaceGid) return NextResponse.json({ error: 'ASANA_WORKSPACE_GID is not set' }, { status: 400 })
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null
        const base = appUrl ? await resolveBase(appUrl) : null
        return NextResponse.json(await connectAsana(workspaceGid, base))
      }

      // ── Discover the workspace gid during first-time setup ──
      case 'workspaces': {
        return NextResponse.json({ workspaces: await asana.listWorkspaces() })
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
    }
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
