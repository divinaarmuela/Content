import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { revalidateJournal } from '@/app/lib/revalidate-site'

const ALLOWED = [
  'slug', 'title', 'standfirst', 'category', 'cover_url', 'read_mins',
  'published_at', 'featured', 'sections', 'sort_order', 'published',
] as const

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('editor')
  if (denied) return denied

  const { id } = await params
  const body = await req.json()

  const patch: Record<string, unknown> = {}
  for (const key of ALLOWED) if (key in body) patch[key] = body[key]
  // an empty date string is not a date; the column is nullable for drafts
  if ('published_at' in patch) patch.published_at = patch.published_at || null

  const { data, error } = await supabase
    .from('journal_posts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    if (error.message.includes('journal_posts_single_featured')) {
      return NextResponse.json(
        { error: 'Another post is already featured. Unfeature it first.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidateJournal()
  return NextResponse.json(data)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guard('account_manager')
  if (denied) return denied

  const { id } = await params
  const { error } = await supabase.from('journal_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateJournal()
  return NextResponse.json({ ok: true })
}
