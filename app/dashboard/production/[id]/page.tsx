import { redirect } from 'next/navigation'
import { table } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { itemPath } from '@/app/lib/workflow-core'
import CardDetail from './CardDetail'

/**
 * THE CARD PAGE — the full page a direct link, an email or the portal lands
 * on. Everything on it is `CardDetail`, the same component the boards slide
 * in from the right; this file only reads the id out of the address.
 *
 * ONE RULE FIRST (the owner, 8 Sep 2026: "nothing goes in the Production
 * page — Production is for shoot plans"): a post uploaded for approval
 * (`adhoc_post`) lives on the Post approval board and nowhere else. However
 * a link to it was made — an old email, the bell, a page that still writes
 * `/dashboard/production/<id>` — it lands on that board, not here. Decided
 * on the server, so it holds for every link at once rather than one at a
 * time.
 */
export const dynamic = 'force-dynamic'

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const item = await table<ContentItem>('content_items').get(id).catch(() => null)
  if (item && (item as { adhoc_post?: unknown }).adhoc_post === true) redirect(itemPath({ id, adhoc_post: true }))
  return <CardDetail id={id} layout="page" />
}
