import 'server-only'
import { table } from '@/lib/db'
import type { Client, ContentItem } from '@/lib/db-types'
import { deliverOnly, type DeliverOnlyCard } from './deliver-only-core'

/**
 * The server's answer to "does this card end at the client's approval?" —
 * the card's own word, else the client's setting, read from the row. A
 * client that cannot be read is treated as one we post for: the safe side
 * is a scheduler seeing a card, never a card vanishing.
 */
export async function deliverOnlyFor(item: Pick<ContentItem, 'client_id'> & DeliverOnlyCard): Promise<boolean> {
  if (item.deliver_only === true) return true
  if (item.deliver_only === false) return false
  try {
    const client = await table<Client>('clients').get(item.client_id) as { posts_own_content?: unknown } | null
    return deliverOnly(item, client)
  } catch (e) {
    console.error('deliver only: could not read the client', e instanceof Error ? e.message : e)
    return false
  }
}

/** The ids of every client who posts their own content — for the scoping
 *  rule that keeps such cards off a scheduler's pages. */
export async function selfPostingClientIds(): Promise<Set<string>> {
  try {
    const rows = await table<Client>('clients').list({ where: r => (r as { posts_own_content?: unknown }).posts_own_content === true })
    return new Set(rows.map(r => r.id))
  } catch {
    return new Set()
  }
}
