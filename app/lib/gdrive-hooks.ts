import 'server-only'
import { after } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  BRAND_FOLDER, EDITS_FOLDER, NO_SHOOT_FOLDER, TASKS_FOLDER,
  brandChain, clientChain, folderNameFor, itemChain, noShootChain, shootChains,
  taskChain, uniqueName,
} from './gdrive-core'
import {
  driveConfigured, ensureChain, ensureChainWithLink, listFolderNames,
  rootFolderId, shareWithDomain,
} from './gdrive'

/**
 * The folder tree, kept in step with the board — without ever getting in the
 * way of it.
 *
 * Two rules govern everything here:
 *
 * 1. **Never block the user.** Creating a shoot is the user's action;
 *    creating its Drive folder is ours. A slow or broken Drive must not make
 *    "New shoot" hang, and must never make it fail. So the hooks are fired and
 *    not awaited, and every path out of them is a caught error and a log line.
 * 2. **Not connected is a no-op, not an error.** The whole integration is
 *    optional. With no Google app credentials, or no connected account, these
 *    functions do nothing at all and say nothing — the board works exactly as
 *    it did before Drive existed.
 *
 * The routes call the `on…` functions, which return void immediately. The
 * `…Now` functions are the awaitable bodies, exported for anything that
 * genuinely needs to wait (a backfill script, a test).
 */

/**
 * Fire a background job that can never take the request down with it.
 *
 * `after()` rather than a bare `void promise`: a folder chain is several round
 * trips to Drive, and a serverless function that has already sent its response
 * can be frozen mid-flight. `after()` is Next's own way of saying "run this
 * once the response is out, and stay alive for it". If it is unavailable (a
 * test, a non-request context) the work still runs detached — the point is
 * only that it is never awaited by the handler.
 */
function detach(label: string, run: () => Promise<unknown>): void {
  const job = async () => {
    try {
      await run()
    } catch (e) {
      console.error(`drive hook (${label}) failed:`, e)
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
  drive_folder_id?: string | null
}

/**
 * `{root}/{Client}/{2026-08 Title}` plus `01 Raw`, `02 Edits`, `03 Final`.
 *
 * Returns the shoot folder's id, whether it was just created or already
 * recorded — items need it, and asking again is how an item created before its
 * shoot folder existed still lands in the right place.
 */
export async function ensureShootFoldersNow(batch: BatchLike): Promise<string | null> {
  if (!driveConfigured()) return null
  if (batch.drive_folder_id) return batch.drive_folder_id

  const client = await clientName(batch.client_id)
  if (!client) return null

  const root = await rootFolderId()
  if (!root) return null

  // the client folder must exist before its contents can be listed; a failure
  // here (no connection, revoked token) ends the hook quietly
  const clientDir = await ensureChain(root, clientChain(client))
  if (!clientDir.ok) return null

  // a second "Content Day" is normal, not an error — and Drive would create
  // BOTH without a murmur, so the suffix is decided here, against what is
  // actually in the folder
  const wanted = folderNameFor.shoot(client, batch.title, batch.shoot_date ?? null, batch.created_at ?? null)
  const name = uniqueName(wanted, await listFolderNames(clientDir.id))

  const chains = shootChains(client, name)
  const shoot = await ensureChain(root, chains.shoot)
  if (!shoot.ok) return null
  // the three working folders, parents already in place
  for (const sub of [chains.raw, chains.edits, chains.final]) {
    const made = await ensureChain(root, sub)
    if (!made.ok) return null
  }

  const url = await shareWithDomain(shoot.id)

  // `is null` guard: two requests racing to fold the same shoot must not
  // overwrite each other's recorded folder — the first one to land wins and
  // the second's folder is simply an empty duplicate
  await supabase.from('batches')
    .update({ drive_folder_id: shoot.id, drive_url: url })
    .eq('id', batch.id)
    .is('drive_folder_id', null)

  return shoot.id
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
  work_kind_id?: string | null
  raw_assets_url?: string | null
  drive_folder_id?: string | null
}

/**
 * Which work kinds are internal: research, strategy, copy — things with
 * nothing to shoot and nothing to post. They file under `_Tasks`.
 *
 * A kind that USES media is a deliverable even with no shoot behind it, and
 * belongs under `_No shoot` instead — which is a real distinction, not a
 * cosmetic one: an editor hunting for footage looks beside the shoots, not
 * among the research jobs.
 */
async function internalKindIds(items: ItemLike[]): Promise<Set<string>> {
  const ids = [...new Set(items.map(i => i.work_kind_id).filter(Boolean))] as string[]
  if (ids.length === 0) return new Set()
  const { data } = await supabase
    .from('work_kinds').select('id, slug, uses_media').in('id', ids)
  return new Set(
    (data ?? [])
      .filter(k => k.slug !== 'shoot_brief' && k.uses_media === false)
      .map(k => k.id as string),
  )
}

/**
 * A folder per deliverable, and the master link prefilled from it.
 *
 * An item that belongs to a shoot gets `{Shoot}/02 Edits/{Reel 01 - Title}`.
 * An item with no shoot lands in one of two places: internal work goes to
 * `{Client}/_Tasks/{Title}`, and an actual deliverable — client-sent phone
 * footage, an ad-hoc cut — goes to `{Client}/_No shoot/{Reel 01 - Title}`.
 *
 * The "Folder link" field the editor works from is prefilled ONLY when it is
 * empty. Someone who has already pasted a link there has made a decision, and
 * a background job must not quietly overwrite it.
 */
export async function ensureItemFoldersNow(items: ItemLike[]): Promise<void> {
  if (!driveConfigured() || items.length === 0) return

  const root = await rootFolderId()
  if (!root) return

  // one client-name lookup per distinct client, not per item
  const names = new Map<string, string | null>()
  for (const clientId of new Set(items.map(i => i.client_id))) {
    names.set(clientId, await clientName(clientId))
  }

  const internal = await internalKindIds(items)

  // resolve each shoot's folder once, creating it if the batch was made in
  // the same request that made the items (the shoot-brief path does exactly
  // that) — otherwise every item would fold into a different duplicate
  const shootDirs = new Map<string, string | null>()
  for (const batchId of new Set(items.map(i => i.batch_id).filter(Boolean) as string[])) {
    const { data } = await supabase.from('batches')
      .select('id, client_id, title, shoot_date, created_at, drive_folder_id')
      .eq('id', batchId).maybeSingle()
    shootDirs.set(batchId, data ? await ensureShootFoldersNow(data as BatchLike) : null)
  }

  // names already taken in each parent folder, so two identically titled
  // items in one shoot get "(2)" rather than two folders nobody can tell apart
  const taken = new Map<string, string[]>()
  const takenIn = async (parentId: string): Promise<string[]> => {
    if (!taken.has(parentId)) taken.set(parentId, await listFolderNames(parentId))
    return taken.get(parentId)!
  }

  for (const item of items) {
    if (item.drive_folder_id) continue
    const client = names.get(item.client_id)
    if (!client) continue

    const shootDir = item.batch_id ? shootDirs.get(item.batch_id) ?? null : null
    const isInternal = Boolean(item.work_kind_id && internal.has(item.work_kind_id))

    // the parent folder, and the kind of name its children carry
    let parentId: string
    let wanted: string
    if (shootDir) {
      const edits = await ensureChain(shootDir, [EDITS_FOLDER])
      if (!edits.ok) continue
      parentId = edits.id
      const siblings = await takenIn(parentId)
      wanted = folderNameFor.item(item.content_type, siblings.length + 1, item.title)
    } else {
      const branch = isInternal ? TASKS_FOLDER : NO_SHOOT_FOLDER
      const parent = await ensureChain(root, [...clientChain(client), branch])
      // one item's folder failing is not the rest of the batch's problem
      if (!parent.ok) continue
      parentId = parent.id
      const siblings = await takenIn(parentId)
      wanted = isInternal
        ? folderNameFor.task(item.title)
        : folderNameFor.item(item.content_type, siblings.length + 1, item.title)
    }

    const siblings = await takenIn(parentId)
    const name = uniqueName(wanted, siblings)
    siblings.push(name)

    const made = await ensureChain(parentId, [name])
    if (!made.ok) continue
    const url = await shareWithDomain(made.id)

    await supabase.from('content_items')
      .update({ drive_folder_id: made.id, drive_url: url })
      .eq('id', item.id)
      .is('drive_folder_id', null)

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
  if (!driveConfigured()) return null
  const client = await clientName(clientId)
  if (!client) return null
  const made = await ensureChainWithLink(brandChain(client))
  return made?.id ?? null
}

/** Re-exported so a caller can predict a chain without creating it. */
export { itemChain, taskChain, noShootChain, BRAND_FOLDER }
