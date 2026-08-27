import 'server-only'
import { supabase } from '@/lib/supabase'
import type { BrandProfile as ScanProfile } from './brand-core'
import {
  emptyProfile, fromScan, normaliseProfile, proposeFromScan, scanIsUnreviewed,
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
  const [{ data: client }, { data: scan }] = await Promise.all([
    supabase.from('clients').select('id, brand_profile').eq('id', clientId).maybeSingle(),
    supabase.from('client_brand').select('profile, docs, updated_at, scan_status').eq('client_id', clientId).maybeSingle(),
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
      await supabase.from('clients')
        .update({ brand_profile: profile, brand_profile_updated_at: new Date().toISOString(), brand_profile_updated_by: seedBy })
        .eq('id', clientId).is('brand_profile', null)
    }
  }

  const proposal = !scanning && scanHasContent && scanIsUnreviewed(profile, lastScanAt)
    ? proposeFromScan(profile, scanProfile, lastScanAt)
    : null

  return { profile, proposal, last_scan_at: lastScanAt, docs: (scan?.docs as unknown[] | null) ?? [], scanning }
}
