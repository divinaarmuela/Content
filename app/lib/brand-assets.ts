import 'server-only'
import { table } from '@/lib/db'
import type { Client, ClientBrand, TeamUserClient } from '@/lib/db-types'
import { attachOne } from '@/lib/db-join'
import { loadBrandProfile } from './brand-profile'
import { normaliseProfile, type BrandProfile } from './brand-profile-core'
import { portalBrandFiles, withBrandFile, type PortalBrandFile } from './brand-assets-core'
import { notify, renderEmail, escapeHtml } from './mailer'

/**
 * BRAND ASSETS ON THE PORTAL, the server half (brand-assets-core has the rules).
 */

/** what the client's Brand assets tab lists: the guideline PDFs and the brand files on their record */
export async function loadPortalBrandFiles(clientId: string): Promise<PortalBrandFile[]> {
  const [client, brand] = await Promise.all([
    table<Client>('clients').get(clientId),
    table<ClientBrand>('client_brand').get(clientId),
  ])
  const profile = client?.brand_profile ? normaliseProfile(client.brand_profile) : null
  return portalBrandFiles(brand?.docs, profile?.logo_files)
}

/**
 * A file the client uploaded goes onto the brand profile's own file list, the one the dashboard's Brand tab keeps.
 *
 * The profile is read through `loadBrandProfile` first, so a client whose profile was never opened is seeded from
 * their brand scan exactly as the dashboard does it: adding one file must never replace a scanned profile with an
 * empty one. The write is a claim against the revision just read; if someone saved in between it is read again.
 */
export async function addClientBrandFile(clientId: string, file: { name: string; url: string }, who: string): Promise<{ ok: true; added: boolean } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const loaded = await loadBrandProfile(clientId, `portal:${who}`)
    if (!loaded) return { ok: false, error: 'Client not found' }
    const profile = loaded.profile as BrandProfile
    const next = withBrandFile(profile.logo_files, file)
    if (next.full) return { ok: false, error: 'This brand already has 100 files. Ask your account manager to clear some first.' }
    if (!next.added) return { ok: true, added: false }
    const seen = profile.rev
    const saved = await table<Client>('clients').claim(clientId, cur => {
      if (!cur) return null
      const liveRev = (cur.brand_profile as { rev?: unknown } | null)?.rev
      const stillTheirs = seen > 0 ? String(liveRev ?? '') === String(seen) : cur.brand_profile == null
      if (!stillTheirs) return null
      return {
        ...cur,
        brand_profile: { ...profile, logo_files: next.files, rev: seen + 1 },
        brand_profile_updated_at: new Date().toISOString(),
        brand_profile_updated_by: `portal:${who}`,
      }
    })
    if (saved.claimed) return { ok: true, added: true }
  }
  return { ok: false, error: 'The brand profile was being edited. Please try that file again.' }
}

/**
 * The client's managers are told in the app's bell, with no email (a client adding five files is not five emails).
 * Never the client. A test client's bell reaches test people only: that gate is the mailer's own.
 */
export async function tellManagersOfBrandFiles(clientId: string, clientName: string, who: string, names: string[]): Promise<void> {
  if (names.length === 0) return
  type Person = { id: string; email: string; role: string; active_status: boolean }
  const links = await table<TeamUserClient>('team_user_clients').list({ by: { client_id: clientId } })
  const joined = await attachOne(links, 'team_user_id', 'team_users', ['id', 'email', 'name', 'role', 'active_status'])
  const managers = joined.map(r => r.team_users as unknown as Person | null)
    .filter((u): u is Person => !!u && (u.role === 'account_manager' || u.role === 'super_admin') && u.active_status)
  const subject = `${clientName} added ${names.length === 1 ? 'a brand file' : `${names.length} brand files`}`
  const path = `/dashboard/clients/${clientId}/brand`
  for (const m of managers) {
    await notify({
      bellOnly: true,
      actorName: who,
      actorEmail: 'portal+client@mdmmarketing.com.au',
      eventType: 'client_brand_file',
      entityType: 'client',
      entityId: `${clientId}#brand#${Date.now()}`,
      recipientId: m.id,
      recipientEmail: m.email,
      clientId,
      subject,
      bodyHtml: renderEmail(subject, `<p>${escapeHtml(names.slice(0, 8).join(', '))}${names.length > 8 ? ' and more' : ''}</p><p style="color:#a1a1aa;font-size:12px;">Added by ${escapeHtml(who)} on the client portal. They are on the client's Brand tab.</p>`, 'Open the Brand tab', path),
    }).catch(() => {})
  }
}
