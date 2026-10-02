import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { portalOwnerByToken } from './portal-owner'
import { oldLinkTarget, onePortal, type OldPortalLink } from './one-portal-core'

/**
 * Where an old portal address goes for a client ON THE ONE PORTAL — null for everyone else, whose old pages are
 * untouched. A piece that is not this client's opens the portal's front page rather than naming another tab.
 */
export async function onePortalRedirect(rawToken: string, link: OldPortalLink): Promise<string | null> {
  const owner = await portalOwnerByToken(rawToken).catch(() => null)
  if (!owner || !onePortal(owner.client)) return null
  if (link.kind !== 'item' && link.kind !== 'edit' && link.kind !== 'approve') return oldLinkTarget(owner.token, link)
  const item = await table<ContentItem>('content_items').get(link.id).catch(() => null)
  if (!item || item.client_id !== owner.client.id) return oldLinkTarget(owner.token, { kind: 'root' })
  const kind = item.work_kind_id
    ? await table<{ id: string; slug: string }>('work_kinds').get(String(item.work_kind_id)).catch(() => null)
    : null
  return oldLinkTarget(owner.token, link, kind?.slug ?? null)
}
