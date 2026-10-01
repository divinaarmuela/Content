'use client'

import { useEffect, useState } from 'react'
import { useRole } from '../../useRole'

/**
 * "Instagram · direct (Meta)" on a post's channel line — SUPER ADMINS ONLY,
 * so testing the agency's own Meta publishing is obvious (1 Oct 2026, branch
 * meta-publish). The server answers which road the post's Instagram takes
 * (/api/meta/instagram/accounts?postId=): a booked post from its jobs, an
 * unbooked one from the rule as it stands (app/lib/meta-route-core.ts). With
 * the client's switch off there is nothing to say, and nothing is drawn.
 *
 * `refreshKey` changes when the post does (its rev, its stage), so the mark
 * follows a booking or a change of channels.
 */
export default function MetaRouteMark({ postId, hasInstagram, refreshKey }: {
  postId: string | null
  hasInstagram: boolean
  refreshKey: string
}) {
  const { can, loading } = useRole()
  const superAdmin = !loading && can('super_admin')
  const [mark, setMark] = useState<{ text: string; meta: boolean } | null>(null)

  useEffect(() => {
    if (!superAdmin || !postId || !hasInstagram) { setMark(null); return }
    let live = true
    fetch(`/api/meta/instagram/accounts?postId=${encodeURIComponent(postId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: { mark?: string | null; route?: { via?: string } | null } | null) => {
        if (!live) return
        setMark(j?.mark ? { text: j.mark, meta: j.route?.via === 'meta' } : null)
      })
      .catch(() => { if (live) setMark(null) })
    return () => { live = false }
  }, [superAdmin, postId, hasInstagram, refreshKey])

  if (!mark) return null
  return (
    <span
      data-meta-route={mark.meta ? 'meta' : 'zernio'}
      title={mark.text}
      className={mark.meta
        ? 'rounded-full bg-tint-amber px-2 py-0.5 text-[11px] font-semibold'
        : 'max-w-[320px] truncate rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground'}
    >
      {mark.text}
    </span>
  )
}
