'use server'

import { getClientSubscriptionToken } from 'inngest/react'
import { inngest } from '../../../inngest/client'
import { monthlyChannel } from '../../../inngest/channels'
import { requireRole } from '../../../lib/authz'

/**
 * Mint a token so a signed-in team member can watch monthly-update progress
 * live. Gated at editor, the same bar as reading the answers. The channel is
 * global and subscribers filter by client_id, so this streams only progress
 * counters (form ids, answered counts, status) — no answer content.
 */
export async function fetchMonthlySubscriptionToken() {
  await requireRole('editor')

  return getClientSubscriptionToken(inngest, {
    channel: monthlyChannel,
    topics: ['progress'],
  })
}
