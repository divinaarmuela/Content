import 'server-only'
import { table } from '@/lib/db'
import type { Client, SocialPost } from '@/lib/db-types'
import { holdDue, onePortal } from './one-portal-core'
import { performSystemTransition } from './post-stage'

/**
 * THE ONE PORTAL'S SWEEP (docs/ONE_PORTAL_SPEC.md R7), run by the publish dispatcher every 10 minutes:
 * a "Wait for the client" post the client has not approved comes off the schedule 15 minutes before its time.
 * Only clients on the one portal are read; every other post is never touched. The engine re-checks inside its
 * claim (holdDue), so a client approving in the same moment wins or the hold is refused — never both.
 */
export async function sweepOnePortal(now = new Date()): Promise<{ held: number }> {
  const clients = await table<Client>('clients').list({ where: c => onePortal(c) })
  if (clients.length === 0) return { held: 0 }
  const ids = new Set(clients.map(c => c.id))
  const booked = await table<SocialPost>('social_posts').list({
    where: r => ids.has(String(r.client_id)) && r.stage === 'booked' && (r as { if_no_answer?: unknown }).if_no_answer === 'wait',
  })
  let held = 0
  for (const row of booked) {
    if (!holdDue(row as never, now.getTime())) continue
    const r = await performSystemTransition(row.id, 'hold_for_client').catch(e => {
      console.error('[one portal] hold failed', row.id, e instanceof Error ? e.message : e)
      return null
    })
    if (r?.ok) held += 1
  }
  return { held }
}
