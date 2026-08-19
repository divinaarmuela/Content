import 'server-only'
import { inngest } from '../inngest/client'
import { productionChannel } from '../inngest/channels'

/**
 * Announce that a production item changed, so every open board, queue,
 * calendar, and item page refreshes itself without a reload.
 *
 * Fire-and-forget by design: the write that caused this has already committed,
 * and a lost hint costs one refresh, not data. Never await it in a request
 * path and never let it throw.
 */
export function announceItemChange(args: {
  item_id: string
  client_id: string
  status: string
  kind: 'created' | 'transition' | 'version' | 'comment' | 'schedule'
}) {
  void inngest.realtime
    .publish(productionChannel.changed, { ...args, ts: Date.now() })
    .catch(e => console.error('production realtime publish failed:', e))
}
