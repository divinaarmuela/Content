import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { guard } from '@/app/lib/authz'
import { signUpload, storageBackend } from '@/app/lib/storage'

const BUCKET = 'website-assets'
/**
 * R2's ceiling for a single PUT, which is how the browser uploads: 4.995 GiB.
 * (An R2 *object* can reach 4.995 TiB, but past this a file has to be split
 * into multipart chunks, which is a different upload flow.)
 *
 * This used to be 200MB, chosen when Supabase was the store and its project
 * limit made anything larger impossible anyway. It stopped being a real
 * constraint the moment R2 was wired up and was just an arbitrary wall.
 */
const MAX_BYTES = Math.floor(4.995 * 1024 * 1024 * 1024)

/** Supabase's project limit is the binding one when R2 is not configured. */
const SUPABASE_MAX_BYTES = 45 * 1024 * 1024

/**
 * Media upload.
 *
 * The FILE goes to Cloudflare R2. The URL goes to Supabase. That is the whole
 * division of labour: R2 stores bytes cheaply with no egress charge, Postgres
 * stores the row that says which project or post the file belongs to. Nothing
 * about a video needs to live in a database.
 *
 * The file never passes through this function either way. A serverless request
 * body caps at roughly 4.5MB on Vercel, and the platform rejects anything
 * bigger before the handler runs — with an HTML error page, which is why the
 * dashboard once reported a JSON parse error instead of anything useful. So
 * the browser asks for a short-lived signed URL (a few hundred bytes of JSON),
 * PUTs the file straight to R2, then calls back to register the URL.
 *
 * Supabase Storage remains only as a fallback for when R2 is not configured,
 * so a fresh install still works before any credentials exist. With R2 set up
 * it is never used.
 */
export async function POST(req: Request) {
  const denied = await guard('editor')
  if (denied) return denied

  if ((req.headers.get('content-type') ?? '').includes('application/json')) {
    const body = await req.json().catch(() => ({})) as {
      action?: string; name?: string; size?: number; type?: string
      url?: string; kind?: string; purpose?: string
      project_id?: string | null; alt?: string | null
    }

    // ── sign: hand back a URL the browser can PUT the file to ──
    if (body.action === 'sign') {
      if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      if ((body.size ?? 0) > MAX_BYTES) {
        return NextResponse.json(
          { error: 'That file is over 5GB, which is the largest a single upload can be.' },
          { status: 413 },
        )
      }
      // Supabase caps a file at the project limit (50MB free), so a large
      // master needs R2. Say so plainly rather than letting the PUT fail with
      // a storage error nobody can act on.
      if (storageBackend() === 'supabase' && (body.size ?? 0) > SUPABASE_MAX_BYTES) {
        return NextResponse.json(
          { error: 'Files above ~45MB need Cloudflare R2, which is not configured yet.' },
          { status: 413 },
        )
      }
      try {
        const signed = await signUpload(body.name, body.type ?? 'application/octet-stream')
        return NextResponse.json({
          signedUrl: signed.signedUrl,
          publicUrl: signed.publicUrl,
          path: signed.key,
          backend: signed.backend,
        })
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not sign upload' },
          { status: 500 },
        )
      }
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
    return NextResponse.json({ error: 'File is too large for this route' }, { status: 413 })
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
