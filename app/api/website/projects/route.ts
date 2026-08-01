import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

/** Admin list — includes unpublished, dashboard-only (Clerk-gated in middleware). */
export async function GET() {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: Request) {
  const body = await req.json()
  if (!body.slug || !body.name) {
    return NextResponse.json({ error: 'slug and name are required' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('projects')
    .insert({
      slug: body.slug,
      name: body.name,
      industry: body.industry ?? '',
      tag: body.tag ?? '',
      services: body.services ?? [],
      description: body.description ?? '',
      card_media_url: body.card_media_url ?? '',
      hero_media_url: body.hero_media_url ?? '',
      result: body.result || null,
      challenge: body.challenge ?? [],
      approach: body.approach ?? [],
      outcome: body.outcome ?? [],
      sort_order: body.sort_order ?? 100,
      published: body.published ?? false,
      client_id: body.client_id ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
