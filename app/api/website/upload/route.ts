import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const BUCKET = 'website-assets'
const MAX_BYTES = 200 * 1024 * 1024 // 200MB — hero videos are large

/** Upload a file to Supabase Storage and register it in the assets table.
 *  multipart/form-data: file (required), purpose, orientation, project_id. */
export async function POST(req: Request) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 200MB limit' }, { status: 413 })
  }

  const kind = file.type.startsWith('video/') ? 'video' : 'image'
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${Date.now()}-${safeName}`

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: file.type, upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const url = pub.publicUrl

  const { error: dbErr } = await supabase.from('assets').insert({
    kind,
    url,
    purpose: (form.get('purpose') as string) || 'general',
    orientation: (form.get('orientation') as string) || null,
    project_id: (form.get('project_id') as string) || null,
    alt: (form.get('alt') as string) || null,
  })
  if (dbErr) console.error('asset register error:', dbErr.message)

  return NextResponse.json({ url, kind })
}
