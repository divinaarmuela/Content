import 'server-only'
import { supabase } from '@/lib/supabase'
import { notify, renderEmail, escapeHtml } from './mailer'
import type { TeamUser } from './authz'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/** The client's standing portal identity: one hidden team_users row per
 *  client (role client, inactive so no notification audience ever emails
 *  it), satisfying every actor/author foreign key with an honest name.
 *  Same row the /api/portal/act route materialises. */
export async function portalActor(clientId: string, clientName: string): Promise<TeamUser> {
  const email = `portal+${clientId}@mdmmarketing.com.au`
  const { data: existing } = await supabase
    .from('team_users').select('*').eq('email', email).maybeSingle()
  if (existing) return existing as TeamUser
  const { data: created, error } = await supabase
    .from('team_users')
    .upsert({
      email,
      name: `${clientName} (client portal)`,
      role: 'client',
      client_id: clientId,
      employment_type: 'contractor',
      timezone: 'Australia/Melbourne',
      active_status: false,
    }, { onConflict: 'email' })
    .select()
    .single()
  if (error || !created) throw new Error(error?.message ?? 'Could not create the portal identity')
  return created as TeamUser
}

/** A client spoke — their managers hear it, never the editor. */
export async function notifyManagersOfComment(opts: {
  clientId: string
  speaker: string
  subjectTitle: string
  body: string
  dashboardPath: string
}) {
  const { data } = await supabase
    .from('team_user_clients')
    .select('team_users!team_user_clients_team_user_id_fkey(id, email, name, role, active_status)')
    .eq('client_id', opts.clientId)
  const managers = (data ?? [])
    .map(r => r.team_users as unknown as { id: string; email: string; role: string; active_status: boolean })
    .filter(u => (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
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
