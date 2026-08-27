import 'server-only'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  clientPath, folderNameFor, itemPath, joinPath, shootPaths, taskPath, uniqueName,
} from './dropbox-core'
import {
  dropboxConfigured, ensureFolders, listFolderNames, rootPath, sharedLink,
} from './dropbox'

/**
 * The folder tree, kept in step with the board — without ever getting in the
 * way of it.
 *
 * Two rules govern everything here:
 *
 * 1. **Never block the user.** Creating a shoot is the user's action;
 *    creating its Dropbox folder is ours. A slow or broken Dropbox must not
 *    make "New shoot" hang, and must never make it fail. So the hooks are
 *    fired and not awaited, and every path out of them is a caught error and
 *    a log line.
 * 2. **Not connected is a no-op, not an error.** The whole integration is
 *    optional. With no app key, or no connected account, these functions do
 *    nothing at all and say nothing — the board works exactly as it did
 *    before Dropbox existed.
 *
 * The routes call the `on…` functions, which return void immediately. The
 * `…Now` functions are the awaitable bodies, exported for anything that
 * genuinely needs to wait (a backfill script, a test).
 */

/**
 * Fire a background job that can never take the request down with it.
 *
 * `after()` rather than a bare `void promise`: a folder chain is several
 * round trips to Dropbox, and a serverless function that has already sent its
 * response can be frozen mid-flight. `after()` is Next's own way of saying
 * "run this once the response is out, and stay alive for it". If it is
 * unavailable (a test, a non-request context) the work still runs detached —
 * the point is only that it is never awaited by the handler.
 */
function detach(label: string, run: () => Promise<unknown>): void {
  const job = async () => {
    try {
      await run()
    } catch (e) {
      console.error(`dropbox hook (${label}) failed:`, e)
    }
  }
  try {
    after(job)
  } catch {
    void job()
  }
}

async function clientName(clientId: string): Promise<string | null> {
  const { data } = await supabase.from('clients').select('name').eq('id', clientId).maybeSingle()
  const name = String(data?.name ?? '').trim()
  return name || null
}

export type BatchLike = {
  id: string
  client_id: string
  title: string
  shoot_date?: string | null
  created_at?: string | null
  dropbox_path?: string | null
}

/**
 * `{root}/{Client}/{2026-08 Title}` plus `01 Raw`, `02 Edits`, `03 Final`.
 *
 * Returns the shoot folder's path, whether it was just created or already
 * recorded — items need it, and asking again is how an item created before
 * its shoot folder existed still lands in the right place.
 */
export async function ensureShootFoldersNow(batch: BatchLike): Promise<string | null> {
  if (!dropboxConfigured()) return null
  if (batch.dropbox_path) return batch.dropbox_path

  const client = await clientName(batch.client_id)
  if (!client) return null

  const root = await rootPath()
  const clientDir = clientPath(root, client)

  // the client folder must exist before its contents can be listed; a failure
  // here (no connection, revoked token) ends the hook quietly
  const base = await ensureFolders([clientDir])
  if (!base.ok) return null

  // a second "Content Day" is normal, not an error — decide the suffix
  // ourselves so the path we store is the path that exists
  const wanted = folderNameFor.shoot(client, batch.title, batch.shoot_date ?? null, batch.created_at ?? null)
  const name = uniqueName(wanted, await listFolderNames(clientDir))

  const paths = shootPaths(root, client, name)
  const made = await ensureFolders([paths.shoot, paths.raw, paths.edits, paths.final])
  if (!made.ok) return null

  const url = await sharedLink(paths.shoot)

  // `is null` guard: two requests racing to fold the same shoot must not
  // overwrite each other's recorded path — the first one to land wins and the
  // second's folder is simply an empty duplicate
  await supabase.from('batches')
    .update({ dropbox_path: paths.shoot, dropbox_url: url })
    .eq('id', batch.id)
    .is('dropbox_path', null)

  return paths.shoot
}

/** Fire-and-forget: call this from the batch-create route. */
export function onBatchCreated(batch: BatchLike): void {
  detach('batch create', () => ensureShootFoldersNow(batch))
}

export type ItemLike = {
  id: string
  client_id: string
  batch_id?: string | null
  title: string
  content_type?: string | null
  raw_assets_url?: string | null
  dropbox_path?: string | null
}

/**
 * A folder per deliverable, and the master link prefilled from it.
 *
 * An item that belongs to a shoot gets `02 Edits/{Reel 01 - Title}`. Internal
 * work — research, strategy, copy — has no shoot behind it and goes to
 * `{Client}/_Tasks/{Title}` instead, which is exactly where someone looking
 * for it would go.
 *
 * The "Folder link" field the editor works from is prefilled ONLY when it is
 * empty. Someone who has already pasted a link there has made a decision, and
 * a background job must not quietly overwrite it.
 */
export async function ensureItemFoldersNow(items: ItemLike[]): Promise<void> {
  if (!dropboxConfigured() || items.length === 0) return

  const root = await rootPath()

  // one client-name lookup per distinct client, not per item
  const names = new Map<string, string | null>()
  for (const clientId of new Set(items.map(i => i.client_id))) {
    names.set(clientId, await clientName(clientId))
  }

  // resolve each shoot's folder once, creating it if the batch was made in
  // the same request that made the items (the shoot-brief path does exactly
  // that) — otherwise every item would fold into a different duplicate
  const shootDirs = new Map<string, string | null>()
  for (const batchId of new Set(items.map(i => i.batch_id).filter(Boolean) as string[])) {
    const { data } = await supabase.from('batches')
      .select('id, client_id, title, shoot_date, created_at, dropbox_path')
      .eq('id', batchId).maybeSingle()
    shootDirs.set(batchId, data ? await ensureShootFoldersNow(data as BatchLike) : null)
  }

  // names already taken in each parent folder, so two identically titled
  // items in one shoot get "(2)" rather than one silently swallowing the other
  const taken = new Map<string, string[]>()
  const takenIn = async (parent: string): Promise<string[]> => {
    if (!taken.has(parent)) taken.set(parent, await listFolderNames(parent))
    return taken.get(parent)!
  }

  for (const item of items) {
    if (item.dropbox_path) continue
    const client = names.get(item.client_id)
    if (!client) continue

    const shootDir = item.batch_id ? shootDirs.get(item.batch_id) ?? null : null

    let parent: string
    let wanted: string
    if (shootDir) {
      parent = joinPath(shootDir, '02 Edits')
      const siblings = await takenIn(parent)
      wanted = folderNameFor.item(item.content_type, siblings.length + 1, item.title)
    } else {
      parent = joinPath(clientPath(root, client), '_Tasks')
      const ensured = await ensureFolders([clientPath(root, client), parent])
      // one item's folder failing is not the rest of the batch's problem
      if (!ensured.ok) continue
      wanted = folderNameFor.task(item.title)
    }

    const siblings = await takenIn(parent)
    const name = uniqueName(wanted, siblings)
    siblings.push(name)

    const path = shootDir
      ? joinPath(parent, name)
      : taskPath(root, client, name)

    const made = await ensureFolders([path])
    if (!made.ok) continue
    const url = await sharedLink(path)

    await supabase.from('content_items')
      .update({ dropbox_path: path, dropbox_url: url })
      .eq('id', item.id)
      .is('dropbox_path', null)

    // the master link, only if the editor has not set one
    if (url && !item.raw_assets_url) {
      await supabase.from('content_items')
        .update({ raw_assets_url: url })
        .eq('id', item.id)
        .is('raw_assets_url', null)
    }
  }
}

/** Fire-and-forget: call this from the item-create route. */
export function onItemsCreated(items: ItemLike[]): void {
  detach('items create', () => ensureItemFoldersNow(items))
}

/** `{root}/{Client}/_Brand` — long-lived reference, independent of any shoot. */
export async function ensureBrandFolderNow(clientId: string): Promise<string | null> {
  if (!dropboxConfigured()) return null
  const client = await clientName(clientId)
  if (!client) return null
  const root = await rootPath()
  const path = joinPath(clientPath(root, client), '_Brand')
  const made = await ensureFolders([clientPath(root, client), path])
  return made.ok ? path : null
}

/** `itemPath` re-exported so a caller can predict a path without creating it. */
export { itemPath }
