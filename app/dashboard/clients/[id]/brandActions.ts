'use server'

import { getClientSubscriptionToken } from 'inngest/react'
import { inngest } from '../../../inngest/client'
import { brandChannel } from '../../../inngest/channels'
import { requireRole } from '../../../lib/authz'

/** Subscription token for brand-scan progress — same bar as reading the
 *  brand profile itself (editor+), minted only for a signed-in team member. */
export async function fetchBrandSubscriptionToken() {
  await requireRole('editor')
  return getClientSubscriptionToken(inngest, {
    channel: brandChannel,
    topics: ['progress'],
  })
}
