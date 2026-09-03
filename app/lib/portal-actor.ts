import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { TeamUser as TeamUserRow, TeamUserClient } from '@/lib/db-types'
import { notify, renderEmail, escapeHtml } from './mailer'
import type { TeamUser } from './authz'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** The client's standing portal identity: one hidden team_users row per
 *  client (role client, inactive so no notification audience ever emails
 *  it), satisfying every actor/author foreign key with an honest name.
 *  Same row the /api/portal/act route materialises. */
export async function portalActor(clientId: string, clientName: string): Promise<TeamUser> {
  const email = `portal+${clientId}@mdmmarketing.com.au`
  const existing = (await table<TeamUserRow>('team_users').list({ by: { email }, limit: 1 }))[0]
  if (existing) return existing as unknown as TeamUser
  let created: TeamUserRow
  try {
    created = await table<TeamUserRow>('team_users').upsert({
      email,
      name: `${clientName} (client portal)`,
      role: 'client',
      client_id: clientId,
      employment_type: 'contractor',
      timezone: 'Australia/Melbourne',
      active_status: false,
    }, { onConflict: 'email' })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Could not create the portal identity')
  }
  return created as unknown as TeamUser
}

/** A client spoke — their managers hear it, never the editor. */
export async function notifyManagersOfComment(opts: {
  clientId: string
  speaker: string
  subjectTitle: string
  body: string
  dashboardPath: string
}) {
  const links = await table<TeamUserClient>('team_user_clients')
    .list({ by: { client_id: opts.clientId } })
  const joined = await attachOne(links, 'team_user_id', 'team_users',
    ['id', 'email', 'name', 'role', 'active_status'])
  const managers = joined
    .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean } | null)
    .filter((u): u is { id: string; email: string; role: string; active_status: boolean } =>
      !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
  for (const m of managers) {
    await notify({
      actorName: opts.speaker,
      actorEmail: 'portal+client@mdmmarketing.com.au', // forces no-reply From, never a name-derived alias
      eventType: 'client_comment',
      entityType: 'portal_comment',
      entityId: `${opts.dashboardPath}#${Date.now()}`,
      recipientId: m.id,
      recipientEmail: m.email,
      subject: `Client comment on ${opts.subjectTitle}`,
      bodyHtml: renderEmail(
        `Client comment on ${opts.subjectTitle}`,
        `<p>${escapeHtml(opts.body.slice(0, 500))}</p><p style="color:#a1a1aa;font-size:12px;">From ${escapeHtml(opts.speaker)} on the client portal.</p>`,
        'Open it',
        `${DASHBOARD_URL}${opts.dashboardPath}`
      ),
    })
  }
}
