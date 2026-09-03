import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'
import { revalidateJournal } from '@/app/lib/revalidate-site'

const ALLOWED = [
  'slug', 'title', 'standfirst', 'category', 'cover_url', 'read_mins',
  'published_at', 'featured', 'sections', 'sort_order', 'published',
] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    const denied = await guard('editor')
    if (denied) return denied

    const { id } = await params
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    for (const key of ALLOWED) if (key in body) patch[key] = body[key]
    // an empty date string is not a date; the column is nullable for drafts
    if ('published_at' in patch) patch.published_at = patch.published_at || null

    const posts = table('journal_posts')

    // `journal_posts_single_featured` was a PARTIAL unique index, so the
    // helper cannot raise it — the rule is checked here instead.
    if (patch.featured === true
      && (await posts.count({ where: r => r.featured === true && r.id !== id })) > 0) {
      return NextResponse.json(
        { error: 'Another post is already featured. Unfeature it first.' },
        { status: 409 },
      )
    }

    try {
      const data = await posts.update(id, patch)
      if (!data) return NextResponse.json({ error: 'Post not found' }, { status: 500 })
      revalidateJournal()
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
      await table('journal_posts').remove(id)
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }

    revalidateJournal()
    return NextResponse.json({ ok: true })
  })
}
