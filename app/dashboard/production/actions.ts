'use server'

import { getClientSubscriptionToken } from 'inngest/react'
import { inngest } from '../../inngest/client'
import { productionChannel } from '../../inngest/channels'
import { AuthzError, requireSignedIn } from '../../lib/authz'

/**
 * Mint a short-lived token so a signed-in TEAM member's browser can subscribe
 * to the production stream.
 *
 * Team roles only, never clients: the channel is global, so its hints carry
 * item ids and statuses across every client. A client's portal polls its own
 * scoped API instead. `requireRole('editor')` would be wrong here — schedulers
 * sit below editor on the ladder and live on this stream.
 */
export async function fetchProductionSubscriptionToken() {
  const user = await requireSignedIn()
  if (user.role === 'client') throw new AuthzError('Not available to client accounts', 403)

  return getClientSubscriptionToken(inngest, {
    channel: productionChannel,
    topics: ['changed'],
  })
}
