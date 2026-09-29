import { E2E, ZZ_CLIENT_ID } from './env'

/**
 * REMOVE WHAT A JOURNEY MADE — and nothing else.
 *
 * The journey first moves its post out of the way through the app (Delete
 * draft or Cancel post, see fixtures.ts), so the app's own rules and claims
 * run. Then this removes the rows that are left, over the database's REST API
 * (the same way lib/db.ts talks to it — no firebase-admin, CLAUDE.md trap 10).
 *
 * Every row is checked before it goes: it must name the ZZ client, or hang
 * off a post or piece this journey made on the ZZ client. A row that fails
 * the check is left alone and reported. Never anything outside /mdm.
 *
 * Left behind on purpose: the uploaded test PNGs in storage (R2), and the
 * shared logs (workflow_activity, notification_log) — they are history, and
 * deleting history is not a test's job.
 */

type Row = Record<string, unknown> & { id?: string }

const base = () => `${E2E.databaseUrl.replace(/\/+$/, '')}/mdm/tables`

async function readTable(table: string): Promise<Record<string, Row>> {
  const res = await fetch(`${base()}/${table}.json`)
  if (!res.ok) throw new Error(`cleanup: reading ${table} answered HTTP ${res.status}`)
  return ((await res.json()) ?? {}) as Record<string, Row>
}

async function removeKey(table: string, key: string): Promise<void> {
  if (!/^[^.#$[\]/]+$/.test(key)) throw new Error(`cleanup: refusing a key that is not a plain row key: ${table}/${key}`)
  const res = await fetch(`${base()}/${table}/${encodeURIComponent(key)}.json`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`cleanup: deleting ${table}/${key} answered HTTP ${res.status}`)
}

/** Delete matching rows of one table; a row naming another client is never deleted. */
async function purge(table: string, match: (row: Row) => boolean, log: string[]): Promise<void> {
  const rows = await readTable(table)
  for (const [key, row] of Object.entries(rows)) {
    if (!row || typeof row !== 'object' || !match(row)) continue
    if ('client_id' in row && row.client_id != null && row.client_id !== ZZ_CLIENT_ID) {
      log.push(`left ${table}/${key}: it names client ${String(row.client_id)}, not the ZZ client`)
      continue
    }
    await removeKey(table, key)
    log.push(`removed ${table}/${key}`)
  }
}

/**
 * Remove the posts and pieces a journey made. `postIds` and `itemIds` are the
 * ones the journey recorded as it made them; a post's own piece is found from
 * the post row as well, so a piece made silently by an upload is not missed.
 */
export async function purgeMade(postIds: readonly string[], itemIds: readonly string[]): Promise<string[]> {
  const log: string[] = []
  if (postIds.length === 0 && itemIds.length === 0) return log
  const posts = new Set(postIds)
  const items = new Set(itemIds)

  // a post's piece, and any post made from a piece we made (a split, a Re-book, Post the missing networks)
  const allPosts = await readTable('social_posts')
  for (const row of Object.values(allPosts)) {
    if (row?.client_id !== ZZ_CLIENT_ID) continue
    if (posts.has(String(row.id)) && row.item_id) items.add(String(row.item_id))
  }
  for (const row of Object.values(allPosts)) {
    if (row?.client_id === ZZ_CLIENT_ID && items.has(String(row.item_id))) posts.add(String(row.id))
  }

  // only pieces that really are the ZZ client's
  const allItems = await readTable('content_items')
  for (const id of [...items]) {
    const row = Object.values(allItems).find(r => r?.id === id)
    if (row && row.client_id !== ZZ_CLIENT_ID) { items.delete(id); log.push(`left content_items/${id}: not the ZZ client's`) }
  }

  const byPost = (row: Row) => posts.has(String(row.post_id))
  await purge('post_comments', byPost, log)
  await purge('post_events', byPost, log)
  await purge('post_versions', byPost, log)
  await purge('publish_jobs', row => items.has(String(row.content_item_id)), log)
  await purge('schedule_entries', row => items.has(String(row.item_id)), log)
  await purge('social_posts', row => posts.has(String(row.id)), log)
  await purge('asset_versions', row => items.has(String(row.item_id)), log)
  await purge('item_comments', row => items.has(String(row.item_id)), log)
  await purge('content_items', row => items.has(String(row.id)) && row.client_id === ZZ_CLIENT_ID, log)
  return log
}

/** Read one row (read only) — for a name the page shows, such as a channel's. */
export async function readRow(table: string, id: string): Promise<Row | null> {
  const res = await fetch(`${base()}/${table}/${encodeURIComponent(id)}.json`)
  if (!res.ok) return null
  return (await res.json()) as Row | null
}
