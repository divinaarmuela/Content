import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { guard } from '@/app/lib/authz'
import { revalidateJournal } from '@/app/lib/revalidate-site'
import { articles as shippedArticles } from '@/app/journal/journalData'

/** All posts for the CMS, published or not. */
export async function GET() {
  return withRequestCache(async () => {
    const denied = await guard('editor')
    if (denied) return denied

    try {
      const data = await table('journal_posts').list({
        orderBy: [['published_at', 'desc'], ['sort_order', 'asc']],
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
    const posts = table('journal_posts')

    /**
     * Import the articles that shipped hardcoded in journalData.ts.
     *
     * Without this the CMS opens empty while the site still shows eleven posts
     * from code — the author sees nothing to edit and no explanation. Existing
     * slugs are skipped, so running it twice is safe and never overwrites edits
     * made since.
     */
    if (body.action === 'import-shipped') {
      const existing = await posts.list().catch(() => [])
      const have = new Set(existing.map(r => r.slug))
      const rows = shippedArticles
        .filter(a => !have.has(a.slug))
        .map((a, i) => ({
          slug: a.slug,
          title: a.title,
          standfirst: a.standfirst,
          category: '',
          cover_url: '',
          read_mins: a.readMins,
          published_at: null,
          // only one post may be featured — importing two would collide
          featured: false,
          sections: a.sections,
          sort_order: (i + 1) * 10,
          published: true,
        }))

      if (rows.length === 0) return NextResponse.json({ imported: 0, skipped: have.size })

      try {
        for (const row of rows) await posts.insert(row)
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 })
      }

      revalidateJournal()
      return NextResponse.json({ imported: rows.length, skipped: have.size })
    }
    const slug = String(body.slug ?? '').trim()
    const title = String(body.title ?? '').trim()
    if (!slug || !title) {
      return NextResponse.json({ error: 'slug and title are required' }, { status: 400 })
    }

    const featured = !!body.featured
    // `journal_posts_single_featured` was a PARTIAL unique index, so the
    // helper cannot raise it — the rule is checked here instead, and the
    // author is told what they did rather than which index they hit.
    if (featured && (await posts.count({ where: r => r.featured === true })) > 0) {
      return NextResponse.json(
        { error: 'Another post is already featured. Unfeature it first.' },
        { status: 409 },
      )
    }

    try {
      const data = await posts.insert({
        slug,
        title,
        standfirst: body.standfirst ?? '',
        category: body.category ?? '',
        cover_url: body.cover_url ?? '',
        read_mins: body.read_mins ?? 3,
        published_at: body.published_at || null,
        featured,
        sections: body.sections ?? [],
        sort_order: body.sort_order ?? 100,
        published: !!body.published,
      })
      revalidateJournal()
      return NextResponse.json(data, { status: 201 })
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }
  })
}
