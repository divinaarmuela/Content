import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { AuthzError, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { canEditItemFields } from '../../../../../lib/item-edit-core'
import { linkKindOf, nextVersionAfterLink } from '../../../../../lib/card-link-core'

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
    const data = await table('content_items').update(id, { link_url: null, link_kind: null })
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
