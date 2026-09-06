import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ContentItem, Batch } from '@/lib/db-types'
import { logActivity } from '../../../lib/workflow'
import { announceItemChange, announceBatchChange } from '../../../lib/production-live'
import { portalActor, notifyManagersOfComment } from '../../../lib/portal-actor'
import { NOT_WITH_YOU, portalActions } from '../../../lib/portal-core'
import type { ItemStatus } from '../../../lib/workflow-core'
import { sanitiseCanvasCards } from '../../../lib/batch-brief-core'
import { canvasCardLabel, commentSubject, findCanvasCard, shootCommentPath } from '../../../lib/canvas-comments-core'

/**
 * A comment from the portal — on a piece, on a shoot, or pinned to ONE card
 * of the shoot's planning board (`card_id`). Token-bearer auth like
 * /api/portal/act; the comment persists in the same thread the team reads,
 * and the client's managers AND the person who created the shoot are told
 * (never the editor, never the client).
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json()
    const rawToken = String(body.token ?? '')
    const token = rawToken.split('--').pop() ?? rawToken
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    }
    const client = (await table<Client>('clients').list({
      where: c => c.share_token === token, limit: 1,
    }))[0]
    if (!client) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })

    const kind = String(body.kind ?? '')
    const id = String(body.id ?? '')
    const text = String(body.body ?? '').trim().slice(0, 4000)
    const authorName = String(body.author_name ?? '').replace(/["<>\r\n]/g, '').trim().slice(0, 60)
    if (!text) return NextResponse.json({ error: 'Write a comment first' }, { status: 400 })
    const speaker = authorName ? `${authorName} · ${client.name}` : client.name
    const actor = await portalActor(client.id, client.name)
    const signed = authorName ? `${text}\n— ${authorName}` : text

    if (kind === 'item') {
      const foundItem = await table<ContentItem>('content_items').get(id)
      const item = foundItem && foundItem.client_id === client.id ? foundItem : null
      if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // a comment is pinned to a card the client can see — a draft nobody has
      // checked is not theirs to talk about yet (same rule as the card)
      if (!portalActions(item.status as ItemStatus).comment) {
        return NextResponse.json({ error: NOT_WITH_YOU }, { status: 403 })
      }
      await table('item_comments').insert({
        item_id: item.id, author_id: actor.id, visibility: 'client', body: signed,
        resolved: false,
      })
      await logActivity({
        actor, clientId: client.id,
        entityType: 'content_item', entityId: item.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      announceItemChange({ item_id: item.id, client_id: client.id, status: item.status, kind: 'comment' })
      await notifyManagersOfComment({
        clientId: client.id, speaker, subjectTitle: item.title, body: text,
        dashboardPath: `/dashboard/production/${item.id}`,
      }).catch(e => console.error('portal comment notify error:', e))
      return NextResponse.json({ ok: true })
    }

    if (kind === 'shoot') {
      const foundBatch = await table<Batch>('batches').get(id)
      const batch = foundBatch && foundBatch.client_id === client.id ? foundBatch : null
      if (!batch || !batch.shared_with_client) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      // pinned to a card of the board: only a card the client can actually
      // see on it — an id that is not on the board is not a card
      const cardId = body.card_id == null ? null : String(body.card_id).slice(0, 80)
      const card = cardId ? findCanvasCard(sanitiseCanvasCards(batch.canvas_cards), cardId) : null
      if (cardId && !card) {
        return NextResponse.json({ error: 'That card is not on the board any more.' }, { status: 404 })
      }
      const cardLabel = card ? canvasCardLabel(card) : null
      try {
        await table('batch_comments').insert({
          batch_id: batch.id, author_id: actor.id, body: signed, resolved: false,
          card_id: card ? card.id : null,
        })
      } catch {
        // the thread could not be written — say so rather than pretending the
        // comment landed
        return NextResponse.json({ error: 'Comments are not set up yet — ask your account manager.' }, { status: 503 })
      }
      await logActivity({
        actor, clientId: client.id,
        entityType: 'batch', entityId: batch.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      // the manager, and whoever created the shoot — the board is theirs
      await notifyManagersOfComment({
        clientId: client.id, speaker, subjectTitle: commentSubject(batch.title, cardLabel), body: text,
        dashboardPath: shootCommentPath(batch.id, card?.id),
        alsoUserIds: [batch.owner_id],
      }).catch(e => console.error('portal comment notify error:', e))
      announceBatchChange({ batch_id: batch.id, client_id: client.id, status: 'brief', kind: 'updated' })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Unknown thread' }, { status: 400 })
  } catch (e) {
    console.error('portal comment error:', e)
    return NextResponse.json({ error: 'Something went wrong — try again' }, { status: 500 })
  }
  })
}
