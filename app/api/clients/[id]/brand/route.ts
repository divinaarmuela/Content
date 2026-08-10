import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'
import { signUpload } from '@/app/lib/storage'
import { extractBrandProfile, type BrandProfile } from '../../../../lib/brand-extract'

/** A 30-page brand PDF is minutes of model time, not seconds. */
export const maxDuration = 300

/**
 * Brand guidelines per client.
 *
 * The browser uploads the PDF straight to storage with a signed URL (the
 * server never carries the bytes twice), then asks for a scan. Extraction is
 * paid once per document; the panel and the assistant read the stored JSON.
 */

const MAX_PDF_BYTES = 25 * 1024 * 1024

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const { data } = await supabase.from('client_brand')
      .select('profile, docs, updated_at, updated_by').eq('client_id', id).maybeSingle()
    return NextResponse.json({
      profile: data?.profile ?? null,
      docs: data?.docs ?? [],
      updated_at: data?.updated_at ?? null,
      can_manage: roleSatisfies(user.role, 'account_manager'),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('account_manager')
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    // ── sign: a URL the browser can PUT the PDF to ──
    if (body?.action === 'sign') {
      if (body?.type !== 'application/pdf') {
        return NextResponse.json({ error: 'Brand guidelines must be a PDF' }, { status: 415 })
      }
      if ((body?.size ?? 0) > MAX_PDF_BYTES) {
        return NextResponse.json({ error: 'That PDF is over 25MB. Export a lighter copy.' }, { status: 413 })
      }
      const signed = await signUpload(String(body?.name ?? 'brand.pdf'), 'application/pdf')
      return NextResponse.json(signed)
    }

    // ── scan: fetch the uploaded PDF, extract, store ──
    if (body?.action === 'scan') {
      const url = String(body?.url ?? '')
      const filename = String(body?.filename ?? 'brand.pdf')
      if (!url.startsWith('https://')) {
        return NextResponse.json({ error: 'No uploaded document to scan' }, { status: 400 })
      }

      const file = await fetch(url)
      if (!file.ok) return NextResponse.json({ error: 'Could not read the uploaded PDF' }, { status: 502 })
      const bytes = Buffer.from(await file.arrayBuffer())
      if (bytes.byteLength > MAX_PDF_BYTES) {
        return NextResponse.json({ error: 'That PDF is over 25MB' }, { status: 413 })
      }

      const { data: existing } = await supabase.from('client_brand')
        .select('profile, docs').eq('client_id', id).maybeSingle()

      const profile = await extractBrandProfile(
        bytes.toString('base64'),
        (existing?.profile ?? null) as BrandProfile | null,
      )

      const docs = [
        ...(existing?.docs ?? []),
        { filename, url, scanned_at: new Date().toISOString() },
      ]
      const { error } = await supabase.from('client_brand').upsert({
        client_id: id, profile, docs,
        updated_at: new Date().toISOString(), updated_by: user.email,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      return NextResponse.json({ profile, docs })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

/** Start over: drop the profile and its document history. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole('super_admin')
    const { id } = await params
    const { error } = await supabase.from('client_brand').delete().eq('client_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
