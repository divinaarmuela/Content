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

/**
 * A client spoke — their managers hear it, never the editor.
 *
 * `alsoUserIds` widens the audience by name: the person who CREATED the
 * thing the client is talking about (a shoot's owner) hears it too, whatever
 * their role, because the client's answer is really for them. Each person is
 * told once — a manager who also created the shoot gets one email, not two —
 * and the client's own portal identity is never in the list.
 */
export async function notifyManagersOfComment(opts: {
  clientId: string
  speaker: string
  subjectTitle: string
  body: string
  dashboardPath: string
  alsoUserIds?: (string | null | undefined)[]
}) {
  type Person = { id: string; email: string; role: string; active_status: boolean }
  const links = await table<TeamUserClient>('team_user_clients')
    .list({ by: { client_id: opts.clientId } })
  const joined = await attachOne(links, 'team_user_id', 'team_users',
    ['id', 'email', 'name', 'role', 'active_status'])
  const managers = joined
    .map(r => r.team_users as unknown as Person | null)
    .filter((u): u is Person =>
      !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
  const extraIds = [...new Set((opts.alsoUserIds ?? []).filter((id): id is string => !!id))]
    .filter(id => !managers.some(m => m.id === id))
  const extras: Person[] = []
  for (const id of extraIds) {
    const u = await table<TeamUserRow>('team_users').get(id) as unknown as Person | null
    if (u && u.active_status && u.role !== 'client' && u.email) extras.push(u)
  }
  for (const m of [...managers, ...extras]) {
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
