import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { Client, ContentItem, Batch } from '@/lib/db-types'
import { logActivity } from '../../../lib/workflow'
import { announceItemChange, announceBatchChange } from '../../../lib/production-live'
import { portalActor, notifyManagersOfComment } from '../../../lib/portal-actor'

/**
 * A comment from a portal child page — item or shoot thread. Token-bearer
 * auth like /api/portal/act; the comment persists in the same thread the
 * team reads, and the client's managers are notified (never the editor).
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
      try {
        await table('batch_comments').insert({
          batch_id: batch.id, author_id: actor.id, body: signed, resolved: false,
        })
      } catch {
        // the thread could not be written — say so rather than pretending the
        // comment landed
        return NextResponse.json({ error: 'Comments are not switched on yet — run supabase/portal_comments.sql' }, { status: 503 })
      }
      await logActivity({
        actor, clientId: client.id,
        entityType: 'batch', entityId: batch.id,
        action: 'comment_added', detail: 'client (portal)',
      })
      await notifyManagersOfComment({
        clientId: client.id, speaker, subjectTitle: batch.title, body: text,
        dashboardPath: `/dashboard/production/shoots/${batch.id}`,
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
