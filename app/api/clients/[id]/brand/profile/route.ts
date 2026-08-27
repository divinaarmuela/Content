import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json().catch(() => null) as { profile?: unknown } | null
    const checked = validateProfile(body?.profile)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })

    const seen = checked.profile.rev
    const next: BrandProfile = { ...checked.profile, rev: seen + 1 }
    let q = supabase.from('clients')
      .update({ brand_profile: next, brand_profile_updated_at: new Date().toISOString(), brand_profile_updated_by: user.email })
      .eq('id', id)
    // optimistic concurrency: the row must still be at the revision the
    // caller edited from. rev 0 means "never saved" — the column is null.
    q = seen > 0 ? q.eq('brand_profile->>rev', String(seen)) : q.is('brand_profile', null)
    const { data, error } = await q.select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
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
}
