import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'
import { revalidateSiteProjects } from '@/app/lib/revalidate-site'
import { normalizeUrls } from '@/app/lib/website-gallery-core'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('editor')
    if (denied) return denied

    const { id } = await params
    const body = await req.json()

    const allowed = [
      'slug', 'name', 'industry', 'tag', 'services', 'description',
      'card_media_url', 'hero_media_url', 'gallery_urls', 'website_url',
      'result', 'challenge', 'approach',
      'outcome', 'sort_order', 'published', 'client_id',
    ] as const
    const patch: Record<string, unknown> = {}
    for (const key of allowed) if (key in body) patch[key] = body[key]
    if ('gallery_urls' in patch) patch.gallery_urls = normalizeUrls(patch.gallery_urls)
    if ('website_url' in patch) patch.website_url = patch.website_url || null

    try {
      const data = await table('projects').update(id, patch)
      if (!data) return NextResponse.json({ error: 'Project not found' }, { status: 500 })
      revalidateSiteProjects()
      return NextResponse.json(data)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
  })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('account_manager')
    if (denied) return denied

    const { id } = await params
    try {
      await table('projects').remove(id)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }

    revalidateSiteProjects()
    return NextResponse.json({ ok: true })
  })
}
