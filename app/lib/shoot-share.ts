import 'server-only'
import { table } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { Batch, BatchComment, Client } from '@/lib/db-types'
import { isShootShareToken, sharedShoot, type SharedCommentRow, type SharedShoot } from './shoot-share-core'

/**
 * THE SHOOT BEHIND A TEAM LINK (shoot-share-core). The token is the only authorisation: an unknown one, or one that was
 * switched off, reads as nothing. Read only; nothing here writes.
 */
export async function loadSharedShoot(token: string): Promise<(SharedShoot & { references: unknown[] }) | null> {
  if (!isShootShareToken(token)) return null
  const batch = (await table<Batch>('batches').list({ where: r => (r as { team_share_token?: unknown }).team_share_token === token, limit: 1 }))[0]
  if (!batch) return null
  return sharedShootOf(batch)
}

/** The page's contents for one shoot's row. Reads the client's name and the shoot's comments; writes nothing. */
export async function sharedShootOf(batch: Batch): Promise<SharedShoot & { references: unknown[] }> {
  const [client, comments] = await Promise.all([
    batch.client_id ? table<Client>('clients').get(String(batch.client_id)).catch(() => null) : Promise.resolve(null),
    table<BatchComment>('batch_comments').list({ by: { batch_id: batch.id }, orderBy: [['created_at', 'asc']], limit: 500 }).catch(() => [] as BatchComment[]),
  ])
  const withAuthors = await attachOne(comments, 'author_id', 'team_users', ['name', 'role']).catch(() => comments as never)
  const rows: SharedCommentRow[] = (withAuthors as unknown as (BatchComment & { team_users?: { name?: string | null; role?: string | null } | null })[]).map(c => ({
    id: c.id,
    body: c.body,
    created_at: c.created_at,
    parent_id: (c as { parent_id?: string | null }).parent_id ?? null,
    anchor_part: (c as { anchor_part?: string | null }).anchor_part ?? null,
    anchor_quote: (c as { anchor_quote?: string | null }).anchor_quote ?? null,
    card_id: (c as { card_id?: string | null }).card_id ?? null,
    resolved: (c as { resolved?: boolean | null }).resolved ?? false,
    author_name: c.team_users?.name ?? null,
    author_role: c.team_users?.role ?? null,
  }))
  const refs = (batch as { reference_media?: unknown }).reference_media
  return { ...sharedShoot(batch as never, client?.name ?? null, rows), references: Array.isArray(refs) ? refs : [] }
}
