import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { AuthzError, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { linkKindOf, nextVersionAfterLink, withLinkVersion } from '../../../../../lib/card-link-core'
import { cancelReplacedPullSoon, startPullSoon } from '../../../../../lib/drive-pull'
import { handInRound } from '../../../../../lib/edit-round-core'

/**
 * THE LINK ON A CARD — set it, or replace it.
 *
 * A card points at where the work lives (Google Drive or Dropbox, pasted).
 * Replacing the link is a new version of the work: `current_version_number`
 * goes up and the History says "Link updated to version N", so the approval
 * trail survives without sub-cards. Nothing here touches Google Drive — a
 * pasted link is a link (CLAUDE.md trap 13).
 *
 * Who: whoever may edit the card — the person holding it, whoever holds its
 * scheduling, or a manager (item-edit-core). ONE conditional write: the
 * version number is read and bumped inside `claim()`, so two people pasting
 * at the same moment get versions N+1 and N+2, never both N+1.
 *
 * `final: true` says the link is the FINISHED EDIT (the editor's "Your
 * finished edit" box), not the folder to work from: the card's folder
 * (`raw_assets_url`) is left as it was. Without it a pasted Drive or
 * Dropbox folder is the card's folder everywhere (card-link-core.folderOf).
 * Before 14 Sep 2026 every pasted folder link overwrote the folder, so the
 * editor's edit replaced the footage folder on their own card.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    // 'scheduler' is the lowest team floor: every team role, no client
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    if (!canEditItemFields(user, item)) {
      return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can change its link' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const check = linkKindOf(body?.url)
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 })
    const final = body?.final === true
    // THE CARD'S FIRST LINK IS THE FILES TO WORK FROM, NEVER A VERSION ON ITS
    // OWN (the owner, 16 Sep 2026). The finished edit is whatever is saved in
    // the finished-edit box — the same link again is allowed ("it's okay to
    // submit the same Drive link"): saved as final, it is Version 1.

    const items = table<ContentItem>('content_items')
    let outcome: { version: number; changed: boolean; replaced: boolean } | null = null
    let taken: Awaited<ReturnType<typeof items.claim>>
    try {
      taken = await items.claim(id, cur => {
        if (!cur) return null
        const next = nextVersionAfterLink(cur, check.url)
        outcome = { ...next, replaced: !!cur.link_url && next.changed }
        if (!next.changed) return null
        return {
          ...cur,
          link_url: check.url,
          link_kind: check.kind,
          // the mark card-link-core.finishedEditOf reads: the finished edit, or a folder
          link_final: final,
          // EVERY CUT STAYS OPENABLE (24 Sep 2026): the card used to hold one link, so each hand-in wrote over
          // the last and the cut the client had commented on could not be opened again
          ...(final ? { link_versions: withLinkVersion(cur as never, { version: next.version, url: check.url, kind: check.kind, by: user.id, at: new Date().toISOString() }) } : {}),
          // a folder is the card's folder everywhere (card-link-core.folderOf)
          // — unless this link is the finished edit, which is not the folder
          ...(check.kind !== 'other' && !final ? { raw_assets_url: check.url } : {}),
          current_version_number: next.version,
        }
      })
    } catch (e) {
      console.error('link claim failed:', (e as Error).message)
      throw new AuthzError('Could not save the link — please try again', 500)
    }
    if (!taken.claimed) {
      // the same link again is not a conflict — nothing to do
      if (taken.current && outcome && !(outcome as { changed: boolean }).changed) {
        // THE SAME LINK AGAIN IS STILL A HAND-IN (the owner, 16 Sep 2026: "they
        // upload the same Drive link but have to re-download for version 2"):
        // the folder is read again and its new files are this round's
        if (check.kind === 'drive' && final) startPullSoon({ kind: 'item', scopeId: id, folderUrl: check.url, version: handInRound(item), by: user.id, purpose: 'finished' })
        return NextResponse.json({ ok: true, already: true, version: (outcome as { version: number }).version, kind: check.kind, label: check.label })
      }
      return NextResponse.json(
        { error: 'This card was just updated by someone else — refresh and try again' },
        { status: 409 },
      )
    }
    const done = outcome as unknown as { version: number; replaced: boolean }
    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: done.replaced ? 'link_updated' : 'link_added',
      newValue: `v${done.version}`,
      detail: done.replaced
        ? `Link updated to version ${done.version}`
        : `Link added (${check.label}) — version ${done.version}`,
    })
    // A DRIVE FOLDER IS PULLED INTO OUR STORAGE the moment it is saved (16 Sep
    // 2026) — the same link with a new cut in it is pulled again, and the
    // files it brings remember this version
    // a finished edit handed in after a send-back is the next version; a
    // folder to work from is not a version at all
    // a different link replacing one whose files were still coming calls that pull off (16 Sep 2026)
    if (done.replaced) cancelReplacedPullSoon({ kind: 'item', scopeId: id, oldUrl: item.link_url ?? null, newUrl: check.url })
    if (check.kind === 'drive') startPullSoon({ kind: 'item', scopeId: id, folderUrl: check.url, version: final ? handInRound(item) : 1, by: user.id, purpose: final ? 'finished' : 'folder' })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({
      ok: true, version: done.version, kind: check.kind, label: check.label, url: check.url,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}

/** Take the link off a card. The version number stays — removing a link is
 *  not a new cut of the work. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    if (!canEditItemFields(user, item)) {
      return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can change its link' }, { status: 403 })
    }
    const data = await table('content_items').update(id, { link_url: null, link_kind: null, link_final: null })
    if (!data) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'link_removed', detail: 'Link removed',
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
