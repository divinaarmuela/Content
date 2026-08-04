'use client'

import { useEffect, useState } from 'react'
import { roleSatisfies, type Role } from '@/app/lib/identity-core'

export type Me = {
  id: string
  email: string
  name: string
  role: Role
  employment_type: 'employee' | 'contractor'
  timezone: string
  active: boolean
}

/**
 * The signed-in user's role, from the server.
 *
 * Deliberately starts as `null` (unknown) rather than assuming a role. The
 * previous code defaulted to 'admin' when Clerk metadata was missing, which
 * meant an unknown identity rendered the *most* privileged UI — the failure
 * ran in the dangerous direction. Callers gate on `can(...)`, which is false
 * until the real role arrives.
 */
export function useRole() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/team/me')
      .then(async r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled) { setMe(data); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return {
    me,
    loading,
    role: me?.role ?? null,
    /** Does this user meet a minimum role? False while unknown. */
    can: (required: Role) => (me ? roleSatisfies(me.role, required) : false),
  }
}
