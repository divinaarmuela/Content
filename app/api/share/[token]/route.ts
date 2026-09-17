import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { Client, ContentItem, DrivePull } from '@/lib/db-types'
import { isShareToken, maySharePublicly, sharedFilesOf } from '../../../lib/share-link-core'
import { downloadHref } from '../../../lib/download-core'
import { roundOf } from '../../../lib/edit-round-core'

/**
 * WHAT A PUBLIC SHARE LINK SHOWS — no sign-in. The card's title, the client,
 * the accepted version and its files, each with a same-origin download
 * address that carries the token. A token that was switched off, or a card
 * that fell back before the client's approval, reads as gone.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!isShareToken(token)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const item = (await table<ContentItem>('content_items').list({ where: r => (r as { share_token?: unknown }).share_token === token, limit: 1 }))[0]
  if (!item || !maySharePublicly(item)) return NextResponse.json({ error: 'This link has been switched off' }, { status: 404 })
  const [client, pulls] = await Promise.all([
    item.client_id ? table<Client>('clients').get(String(item.client_id)) : Promise.resolve(null),
    table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never }),
  ])
  const files = sharedFilesOf(item as never, pulls as never)
    .map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, href: downloadHref(f, token) }))
  return NextResponse.json({
    title: item.title,
    client: client?.name ?? null,
    version: roundOf(item),
    files,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
