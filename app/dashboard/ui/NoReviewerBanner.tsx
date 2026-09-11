'use client'

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import type { Me } from '../useRole'

/**
 * NOBODY IS FLAGGED AS THE QUALITY REVIEWER.
 *
 * Until somebody is, every quality check falls to the super admins (the
 * stand-in rule in workflow-core) and every "now Quality check" email goes
 * to all of them. That is the rule working, but it is not the playbook's
 * flow — Joy is. So the super admins are told, once, on the pages where
 * they would notice it, with the one place to fix it. Gone the moment
 * somebody is flagged; never shown to anyone who cannot set it.
 */
export default function NoReviewerBanner({ me }: { me: Me | null }) {
  if (!me || me.role !== 'super_admin' || me.quality_reviewer_set !== false) return null
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-inner border border-accent-amber/40 bg-tint-amber px-4 py-3 text-[14px] text-foreground">
      <ShieldAlert className="h-5 w-5 shrink-0" strokeWidth={1.8} aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">No quality reviewer is set.</span>{' '}
        Every quality check comes to you until one is.
      </p>
      <Link href="/dashboard/team"
        className="inline-flex min-h-11 items-center rounded-full bg-foreground px-4 text-[13px] font-semibold text-background hover:bg-foreground/90">
        Set one on the Team page
      </Link>
    </div>
  )
}
