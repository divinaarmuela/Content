import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { revalidateJournal } from '@/app/lib/revalidate-site'

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
