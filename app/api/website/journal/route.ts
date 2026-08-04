import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { revalidateJournal } from '@/app/lib/revalidate-site'
import { articles as shippedArticles } from '@/app/journal/journalData'

/** All posts for the CMS, published or not. */
export async function GET() {
  const denied = await guard('editor')
  if (denied) return denied

  const { data, error } = await supabase
    .from('journal_posts')
    .select('*')
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('sort_order', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const denied = await guard('editor')
  if (denied) return denied

  const body = await req.json()

  /**
   * Import the articles that shipped hardcoded in journalData.ts.
   *
   * Without this the CMS opens empty while the site still shows eleven posts
   * from code — the author sees nothing to edit and no explanation. Existing
   * slugs are skipped, so running it twice is safe and never overwrites edits
   * made since.
   */
  if (body.action === 'import-shipped') {
    const { data: existing } = await supabase.from('journal_posts').select('slug')
    const have = new Set((existing ?? []).map(r => r.slug))
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
        // featured is a partial unique index — importing two would collide
        featured: false,
        sections: a.sections,
        sort_order: (i + 1) * 10,
        published: true,
      }))

    if (rows.length === 0) return NextResponse.json({ imported: 0, skipped: have.size })

    const { error } = await supabase.from('journal_posts').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    revalidateJournal()
    return NextResponse.json({ imported: rows.length, skipped: have.size })
  }
  const slug = String(body.slug ?? '').trim()
  const title = String(body.title ?? '').trim()
  if (!slug || !title) {
    return NextResponse.json({ error: 'slug and title are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('journal_posts')
    .insert({
      slug,
      title,
      standfirst: body.standfirst ?? '',
      category: body.category ?? '',
      cover_url: body.cover_url ?? '',
      read_mins: body.read_mins ?? 3,
      published_at: body.published_at || null,
      featured: !!body.featured,
      sections: body.sections ?? [],
      sort_order: body.sort_order ?? 100,
      published: !!body.published,
    })
    .select()
    .single()

  if (error) {
    // the partial unique index on featured is the likely culprit, and its raw
    // message names an index rather than the thing the author did
    if (error.message.includes('journal_posts_single_featured')) {
      return NextResponse.json(
        { error: 'Another post is already featured. Unfeature it first.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidateJournal()
  return NextResponse.json(data, { status: 201 })
}
