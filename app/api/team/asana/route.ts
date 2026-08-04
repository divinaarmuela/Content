import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse } from '@/app/lib/authz'
import * as asana from '@/app/lib/asana'
import { reconcileAll, linkUsersByEmail } from '@/app/lib/asana-sync'

/**
 * Asana connection admin — super_admin only.
 *
 * Everything here names or mutates infrastructure (tokens, webhooks, which
 * projects are watched), so it sits above the rollup's `scheduler` gate.
 */

export const dynamic = 'force-dynamic'

/** Connection state for the setup panel. */
export async function GET() {
  try {
    await requireRole('super_admin')

    const configured = asana.asanaConfigured()
    const workspaceGid = process.env.ASANA_WORKSPACE_GID ?? null

    const [{ data: mapped }, { data: hooks }, { data: team }] = await Promise.all([
      supabase.from('asana_project_map').select('*').order('project_name'),
      supabase.from('asana_webhooks').select('*'),
      supabase
        .from('team_users')
        .select('id,name,email,asana_user_gid')
        .eq('active_status', true)
        .neq('role', 'client')
        .order('name'),
    ])

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
      mapped: mapped ?? [],
      webhooks: hooks ?? [],
      team: team ?? [],
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request) {
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
        const { error } = await supabase.from('asana_project_map').upsert(
          {
            project_gid: body.projectGid,
            project_name: body.projectName ?? '',
            client_id: body.clientId ?? null,
            tracked: body.tracked ?? true,
          },
          { onConflict: 'project_gid' }
        )
        if (error) throw new Error(error.message)
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
        const target = `${base.replace(/\/$/, '')}/api/asana/webhook?project=${body.projectGid}`
        try {
          const hook = await asana.createWebhook(body.projectGid, target)
          await supabase
            .from('asana_webhooks')
            .upsert({ project_gid: body.projectGid, webhook_gid: hook.gid }, { onConflict: 'project_gid' })
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
        return NextResponse.json(await reconcileAll())
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
}
