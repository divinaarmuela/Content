import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Client, ClientAgreement, ClientContact, TeamUser, TeamUserClient } from '@/lib/db-types'
import { requireRole } from '../../../../lib/authz'
import { accessibleClientIds } from '../../../../lib/production-access'
import { defaultOnboarding, type OnboardingDraft } from '../../../../lib/onboarding-email-core'

/** who may open and save a client's welcome email: these two roles, on their own clients */
export const ONBOARDING_ROLES = ['account_manager', 'super_admin']

export async function onboardingGate(clientId: string) {
  const user = await requireRole('account_manager')
  // requireRole is a ladder; this page is these two roles by name
  if (!ONBOARDING_ROLES.includes(user.role)) return { denied: NextResponse.json({ error: 'Only account managers and super admins can open onboarding' }, { status: 403 }) }
  const ids = await accessibleClientIds(user)
  if (ids !== null && !ids.includes(clientId)) return { denied: NextResponse.json({ error: 'You are not assigned to this client' }, { status: 403 }) }
  return { user }
}

/** where the email's pictures are served from: the configured site, else wherever this request came in */
export function assetBaseOf(req: Request): string {
  const set = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  return set || new URL(req.url).origin
}

/** everything the email is built from that is not the draft: the first draft, the portal link, where pictures live */
export async function onboardingContext(client: Client, req: Request): Promise<{
  suggested: OnboardingDraft; portalUrl: string | null; assetBase: string
}> {
  const [agreements, contacts, links] = await Promise.all([
    table<ClientAgreement>('client_agreements').list({ by: { client_id: client.id }, limit: 1 }),
    table<ClientContact>('client_contacts').list({ by: { client_id: client.id } }),
    table<TeamUserClient>('team_user_clients').list({ by: { client_id: client.id } }),
  ])
  const agreement = agreements[0] ?? null
  const primary = contacts.find(c => c.is_primary === true) ?? null
  const people = await Promise.all(links.map(l => table<TeamUser>('team_users').get(l.team_user_id).catch(() => null)))
  const manager = people.find(u => u && u.active_status && u.role === 'account_manager') ?? null
  const contactName = primary?.name || client.contact_name || ''
  const assetBase = assetBaseOf(req)
  const portalUrl = client.share_token ? `${assetBase}/portal/${client.share_token}` : null
  const suggested = defaultOnboarding({
    clientName: client.name,
    contactName,
    lines: Array.isArray(agreement?.deliverable_lines) ? agreement!.deliverable_lines as { label: string; monthly_qty: number }[] : [],
    services: Array.isArray(agreement?.services) ? agreement!.services as { label: string; active: boolean }[] : [],
    startDate: agreement?.start_date ?? null,
    managerName: manager?.name ?? null,
  })
  return { suggested, portalUrl, assetBase }
}
