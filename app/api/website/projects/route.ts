import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'
import { revalidateSiteProjects } from '@/app/lib/revalidate-site'
import { normalizeUrls } from '@/app/lib/website-gallery-core'

/** Admin list — includes unpublished, dashboard-only (Clerk-gated in middleware). */
export async function GET() {
  return withRequestCache(async () => {
    const denied = await guard('scheduler')
    if (denied) return denied

    try {
      const data = await table('projects').list({
        orderBy: [['sort_order', 'asc'], ['created_at', 'asc']],
      })
      return NextResponse.json(data)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
  })
}

export async function POST(req: Request) {
  return withRequestCache(async () => {
    const denied = await guard('editor')
    if (denied) return denied

    const body = await req.json()
    if (!body.slug || !body.name) {
      return NextResponse.json({ error: 'slug and name are required' }, { status: 400 })
    }
    try {
      const data = await table('projects').insert({
        slug: body.slug,
        name: body.name,
        industry: body.industry ?? '',
        tag: body.tag ?? '',
        services: body.services ?? [],
        description: body.description ?? '',
        card_media_url: body.card_media_url ?? '',
        hero_media_url: body.hero_media_url ?? '',
        gallery_urls: normalizeUrls(body.gallery_urls),
        website_url: body.website_url || null,
        result: body.result || null,
        challenge: body.challenge ?? [],
        approach: body.approach ?? [],
        outcome: body.outcome ?? [],
        sort_order: body.sort_order ?? 100,
        published: body.published ?? false,
        client_id: body.client_id ?? null,
      })
      revalidateSiteProjects()
      return NextResponse.json(data, { status: 201 })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
  })
}
