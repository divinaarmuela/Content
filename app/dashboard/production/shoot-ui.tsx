'use client'

import type { BatchStatus } from '../../lib/batch-brief-core'

/**
 * `/api/team/me` answered, and it did not know who we are.
 *
 * The work pages hang everything off the viewer, so without one there is
 * nothing honest to draw. Showing the loading skeleton forever would be a lie
 * about what is happening; this says it, and names the two things that fix it.
 */
export function AccountUnavailable() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-6 py-14 text-center">
      <p className="text-body-15 text-muted-foreground">
        Couldn’t load your account — refresh, or sign in again.
      </p>
    </div>
  )
}

/** Status badge classes shared by the shoots view, brief page, and board chips. */
export const BATCH_STATUS_STYLE: Record<BatchStatus, string> = {
  brief: 'border-accent-amber/35 bg-tint-amber text-foreground',
  locked: 'border-border bg-paper text-foreground',
  shot: 'border-accent-green/30 bg-tint-green text-foreground',
  wrapped: 'border-border bg-foreground/[0.04] text-muted-foreground',
}
