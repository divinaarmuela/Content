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

const TZ_SYNCED = 'md-tz-synced'

/**
 * Keep the profile's zone in step with where the person actually is.
 *
 * `team_users.timezone` is not decoration: the Team Activity rollup decides
 * what is overdue with it, the assistant tells people the time in it, and the
 * greeting falls back to it. Its default is Melbourne, and nobody ever opens
 * Settings to change a field they did not know existed — so a contractor in
 * Manila was Melbourne to every one of those, for months.
 *
 * The browser knows. Once per session, quietly, if it disagrees with the
 * profile, the profile follows it. Silent by design: this is housekeeping, not
 * something to interrupt somebody's morning with a toast about. It is also
 * best-effort — a failed sync costs nothing, so it is never retried and never
 * surfaced.
 */
function syncTimezone(me: Me): void {
  try {
    if (sessionStorage.getItem(TZ_SYNCED)) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    sessionStorage.setItem(TZ_SYNCED, '1')
    if (!zone || zone === me.timezone) return
    void fetch('/api/team/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: zone }),
    }).catch(() => { /* best effort — the greeting reads the browser anyway */ })
  } catch {
    /* no sessionStorage (private mode), no zone — neither is worth a failure */
  }
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
/**
 * Where the answer got to.
 *
 * `none` is the one that was missing, and it cost a new starter the whole
 * dashboard. A 403 from /api/team/me — "no invitation found for this account"
 * — was mapped to `me = null`, identical to "the answer has not arrived".
 * The layout treats an unknown role as still-loading, correctly, so a user
 * whose role would NEVER arrive sat in front of two skeletons forever. A
 * refusal is an answer, and has to be able to say so.
 */
export type IdentityState = 'loading' | 'ready' | 'none' | 'unreachable'

export function useRole() {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [identity, setIdentity] = useState<IdentityState>('loading')
  /** the server's own reason, when it gave one — it is written for a person */
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/team/me')
      .then(async r => {
        if (r.ok) return { data: await r.json(), state: 'ready' as const, why: null }
        // 401/403/404 are answers: this account has no place in the team yet
        const body = await r.json().catch(() => ({})) as { error?: string }
        return {
          data: null,
          state: 'none' as const,
          why: typeof body.error === 'string' && body.error.trim() ? body.error : null,
        }
      })
      .then(({ data, state, why }) => {
        if (cancelled) return
        setMe(data)
        setIdentity(data ? state : state)
        setReason(why)
        setLoading(false)
        if (data) syncTimezone(data as Me)
      })
      .catch(() => {
        // a dropped connection is not the same as being turned away, and must
        // not be shown as one
        if (cancelled) return
        setIdentity('unreachable')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return {
    me,
    loading,
    identity,
    /** the server answered, and the answer was no */
    noAccount: identity === 'none' || identity === 'unreachable',
    reason,
    role: me?.role ?? null,
    /** Does this user meet a minimum role? False while unknown. */
    can: (required: Role) => (me ? roleSatisfies(me.role, required) : false),
  }
}
