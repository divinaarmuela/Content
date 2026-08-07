'use server'

import { getClientSubscriptionToken } from 'inngest/react'
import { inngest } from '../../inngest/client'
import { leadsChannel } from '../../inngest/channels'
import { requireRole } from '../../lib/authz'

/**
 * Mint a short-lived token so a signed-in team member's browser can subscribe
 * to the leads stream.
 *
 * The authorisation gate is the point of this file. A subscription token is
 * bearer access to every lead announcement — the names and businesses of
 * people enquiring — so it is minted only for a signed-in team member at
 * editor or above, the same bar as reading /api/leads. `requireRole` throws,
 * which surfaces to the hook as an error rather than a silently empty stream.
 *
 * `getClientSubscriptionToken` from inngest/react, not `getSubscriptionToken`
 * from inngest/realtime: the former returns the shape `useRealtime` consumes
 * directly. The latter hands back a ChannelInstance carrying zod methods,
 * which Next.js cannot serialise across the server-action boundary.
 */
export async function fetchLeadsSubscriptionToken() {
  await requireRole('editor')

  return getClientSubscriptionToken(inngest, {
    channel: leadsChannel,
    topics: ['created'],
  })
}
