'use server'

import { getClientSubscriptionToken } from 'inngest/react'
import { inngest } from '../../../inngest/client'
import { intakeChannel } from '../../../inngest/channels'
import { requireRole } from '../../../lib/authz'

/**
 * Mint a token so a signed-in team member can watch intake form progress live.
 *
 * Gated at editor, the same bar as reading the form's answers. The channel is
 * global and subscribers filter by client_id, so this token technically streams
 * progress counters for every client — form ids, answered counts, status. No
 * answer content and no personal data crosses it, which is why a single shared
 * channel is acceptable here; anything richer would need a per-client channel
 * and an ownership check on the id.
 */
export async function fetchIntakeSubscriptionToken() {
  await requireRole('editor')

  return getClientSubscriptionToken(inngest, {
    channel: intakeChannel,
    topics: ['progress'],
  })
}
