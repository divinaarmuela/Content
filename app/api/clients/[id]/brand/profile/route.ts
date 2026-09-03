import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client } from '@/lib/db-types'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../../lib/authz'
import { loadBrandProfile } from '../../../../../lib/brand-profile'
import { validateProfile, type BrandProfile } from '../../../../../lib/brand-profile-core'

/**
 * The editable brand profile.
 *
 * GET seeds it from the scan the first time (so nothing already extracted is
 * lost) and reports what a newer scan would add. PATCH replaces the whole
 * profile, but only when the caller saw the latest revision — two account
 * managers editing at once cannot silently undo each other.
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const loaded = await loadBrandProfile(id, user.email)
    if (!loaded) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    return NextResponse.json({ ...loaded, can_edit: roleSatisfies(user.role, 'account_manager') })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json().catch(() => null) as { profile?: unknown } | null
    const checked = validateProfile(body?.profile)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

    const seen = checked.profile.rev
    const next: BrandProfile = { ...checked.profile, rev: seen + 1 }

    // the row must still be at the revision the caller edited from — checked
    // INSIDE the write, so two editors saving together cannot both pass.
    // rev 0 means "never saved": no profile at all.
    const saved = await table<Client>('clients').claim(id, cur => {
      if (!cur) return null
      const liveRev = (cur.brand_profile as { rev?: unknown } | null)?.rev
      const stillTheirs = seen > 0
        ? String(liveRev ?? '') === String(seen)
        : cur.brand_profile == null
      if (!stillTheirs) return null
      return {
        ...cur,
        brand_profile: next,
        brand_profile_updated_at: new Date().toISOString(),
        brand_profile_updated_by: user.email,
      }
    })
    if (!saved.claimed) {
      return NextResponse.json(
        { error: 'Someone else changed this brand profile just now. The page will reload with their version.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ profile: next })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
