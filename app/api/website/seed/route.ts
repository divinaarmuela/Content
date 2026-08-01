import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { clients as hardcoded, wixImg } from '../../../components/lama/workData'

/** One-time import: copies the hardcoded workData projects into the CMS.
 *  Creates a client row per project and a published project row. Skips any
 *  slug that already exists, so it's safe to run again. */
export async function POST() {
  const { data: existing, error: exErr } = await supabase.from('projects').select('slug')
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  const have = new Set((existing ?? []).map(r => r.slug))

  let created = 0
  for (const [i, c] of hardcoded.entries()) {
    if (have.has(c.slug)) continue

    const { data: clientRow, error: cErr } = await supabase
      .from('clients')
      .upsert({ slug: c.slug, name: c.name, industry: c.industry }, { onConflict: 'slug' })
      .select()
      .single()
    if (cErr) return NextResponse.json({ error: `client ${c.slug}: ${cErr.message}` }, { status: 500 })

    const { error: pErr } = await supabase.from('projects').insert({
      client_id: clientRow.id,
      slug: c.slug,
      name: c.name,
      industry: c.industry,
      tag: c.tag,
      services: c.services,
      description: c.desc,
      card_media_url: wixImg(c.img, 1000, 800),
      hero_media_url: wixImg(c.img, 1600, 800),
      result: c.result ?? null,
      challenge: c.study.challenge,
      approach: c.study.approach,
      outcome: c.study.outcome,
      sort_order: (i + 1) * 10,
      published: true,
    })
    if (pErr) return NextResponse.json({ error: `project ${c.slug}: ${pErr.message}` }, { status: 500 })
    created++
  }

  return NextResponse.json({ created, skipped: hardcoded.length - created })
}
