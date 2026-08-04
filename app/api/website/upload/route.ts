import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'

const BUCKET = 'website-assets'
const MAX_BYTES = 200 * 1024 * 1024 // 200MB — hero videos are large

/**
 * Media upload.
 *
 * Large files do NOT pass through this function. A serverless request body is
 * capped at roughly 4.5MB on Vercel, and the platform rejects anything bigger
 * before the handler runs — answering with an HTML error page, which is why
 * the dashboard reported a JSON parse error instead of anything useful. The
 * 200MB limit below could never actually be reached for a video.
 *
 * So the browser asks for a short-lived signed URL (a few hundred bytes of
 * JSON), PUTs the file straight to Supabase Storage, then calls back to
 * register it. Nothing large crosses Vercel in either direction.
 *
 * The multipart branch below still works for small files and older callers.
 */
export async function POST(req: Request) {
  const denied = await guard('editor')
  if (denied) return denied

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await req.json().catch(() => ({})) as {
      action?: string; name?: string; size?: number
      url?: string; kind?: string; purpose?: string
      project_id?: string | null; alt?: string | null
    }

    // ── sign: hand back a URL the browser can PUT the file to ──
    if (body.action === 'sign') {
      if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      if ((body.size ?? 0) > MAX_BYTES) {
        return NextResponse.json({ error: 'File exceeds the 200MB limit' }, { status: 413 })
      }
      const path = `${Date.now()}-${body.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error || !data) {
        return NextResponse.json({ error: error?.message ?? 'Could not sign upload' }, { status: 500 })
      }
      const { data: signedPub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl: signedPub.publicUrl })
    }

    // ── register: index a file that is already stored ──
    if (body.action === 'register') {
      if (!body.url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
      const { error } = await supabase.from('assets').insert({
        kind: body.kind ?? 'image',
        url: body.url,
        purpose: body.purpose || 'general',
        project_id: body.project_id || null,
        alt: body.alt || null,
      })
      // the file is stored already — failing to index it must not fail the upload
      if (error) console.error('asset register error:', error.message)
      return NextResponse.json({ url: body.url, kind: body.kind ?? 'image' })
    }

    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  }

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
