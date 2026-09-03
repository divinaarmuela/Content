import 'server-only'
import { table } from '@/lib/db'
import type { Client, ClientBrand } from '@/lib/db-types'
import type { BrandProfile as ScanProfile } from './brand-core'
import {
  emptyProfile, fromScan, foldScanIntoProfile, normaliseProfile, proposeFromScan, scanIsUnreviewed,
  type BrandProfile, type Proposal,
} from './brand-profile-core'

/**
 * Read a client's editable brand profile, seeding it from the guidelines scan
 * the first time so nothing already extracted is lost, and reporting what a
 * newer scan would add. The pure rules live in brand-profile-core.ts.
 */

export type LoadedBrandProfile = {
  profile: BrandProfile
  /** additions a newer scan offers, or null when there is nothing to review */
  proposal: Proposal | null
  last_scan_at: string | null
  docs: unknown[]
  scanning: boolean
}

export async function loadBrandProfile(clientId: string, seedBy: string): Promise<LoadedBrandProfile | null> {
  const clients = table<Client>('clients')
  const [client, scan] = await Promise.all([
    clients.get(clientId),
    table<ClientBrand>('client_brand').get(clientId),
  ])
  if (!client) return null

  const scanProfile = (scan?.profile ?? null) as ScanProfile | null
  const scanHasContent = Boolean(scanProfile && Object.keys(scanProfile).length > 0)
  const scanning = scan?.scan_status === 'scanning' || scan?.scan_status === 'queued'
  const lastScanAt = scanHasContent && scan?.updated_at ? String(scan.updated_at) : null

  let profile: BrandProfile
  if (client.brand_profile) {
    profile = normaliseProfile(client.brand_profile)
  } else {
    // first read: the scan becomes the profile, once. Written only while the
    // column is still empty, so two first reads cannot both seed.
    profile = scanHasContent ? fromScan(scanProfile, lastScanAt) : emptyProfile()
    profile.rev = 1
    if (scanHasContent) {
      // one conditional write, applied only while the column is still empty:
      // two first reads cannot both seed
      await clients.claim(clientId, cur =>
        cur && cur.brand_profile == null
          ? {
              ...cur,
              brand_profile: profile,
              brand_profile_updated_at: new Date().toISOString(),
              brand_profile_updated_by: seedBy,
            }
          : null)
    }
  }

  const proposal = !scanning && scanHasContent && scanIsUnreviewed(profile, lastScanAt)
    ? proposeFromScan(profile, scanProfile, lastScanAt)
    : null

  return { profile, proposal, last_scan_at: lastScanAt, docs: (scan?.docs as unknown[] | null) ?? [], scanning }
}

/**
 * Fold a freshly-scanned brand profile into the client's EDITABLE profile,
 * filling only the fields that are still empty. Called when a scan completes so
 * a brand-guide's colours and fonts actually land on the Brand tab, instead of
 * sitting in the raw scan row waiting for someone to open the panel and accept a
 * proposal — which is exactly why a Turnkey-style palette never appeared after
 * intake enrichment had already made the profile non-null.
 *
 * fill-only-if-empty, so a hand edit is never overwritten; rev-guarded, so a
 * concurrent edit is not clobbered (retry once). Best-effort caller.
 */
export async function applyScanToEditableProfile(
  clientId: string, scanProfile: ScanProfile | null, by: string,
): Promise<'updated' | 'unchanged'> {
  if (!scanProfile || Object.keys(scanProfile).length === 0) return 'unchanged'
  const clients = table<Client>('clients')
  // The rev guard IS the write. The merge runs on the row as it really is,
  // and the result lands only if that row has not moved since — a concurrent
  // scan or hand edit makes this lose, re-merge onto the newer profile and
  // try again, rather than clobber it.
  const done = await clients.claim(clientId, cur => {
    if (!cur) return null
    const raw = cur.brand_profile
    const current = normaliseProfile(raw ?? {})
    const { profile, changed } = foldScanIntoProfile(current, scanProfile)
    if (!changed) return null
    const next: BrandProfile = { ...profile, rev: (raw != null ? current.rev : 0) + 1 }
    return {
      ...cur,
      brand_profile: next,
      brand_profile_updated_at: new Date().toISOString(),
      brand_profile_updated_by: by,
    }
  })
  return done.claimed ? 'updated' : 'unchanged'
}
