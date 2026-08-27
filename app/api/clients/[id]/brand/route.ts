import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireRole, authzErrorResponse, roleSatisfies } from '../../../../lib/authz'
import { signUpload } from '@/app/lib/storage'
import { inngest } from '../../../../inngest/client'
import { mirrorBrandDoc } from '../../../../lib/gdrive-mirror'

/**
 * Brand guidelines per client.
 *
 * The browser uploads the PDF straight to storage with a signed URL (the
 * server never carries the bytes twice), then asks for a scan. The scan
 * itself runs as a BACKGROUND JOB: a real guidelines document is 60 image
 * heavy pages, chunked into several model calls, which is minutes of work —
 * far past any serverless request budget. Progress streams to the panel over
 * realtime and the profile appears when it lands.
 *
 * Extraction is paid once per document; everything downstream reads the
 * stored JSON, never the PDF again.
 */

/** Storage takes 5TB objects; this is only a sanity bound. Print masters run
 *  to hundreds of megabytes and are exactly what clients send. */
const MAX_PDF_BYTES = 2 * 1024 * 1024 * 1024

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // scheduler+: everyone producing or captioning for a client needs the
    // brand guide — schedulers write captions in the brand voice
    const user = await requireRole('scheduler')
    const { id } = await params
    const { data } = await supabase.from('client_brand')
      .select('profile, docs, updated_at, updated_by, scan_status, scan_done, scan_total, scan_message')
      .eq('client_id', id).maybeSingle()
    return NextResponse.json({
      profile: data?.profile ?? null,
      docs: data?.docs ?? [],
      updated_at: data?.updated_at ?? null,
      // a scan running right now, so reopening the tab shows it rather than
      // an idle page that looks like nothing happened
      scan: data?.scan_status
        ? (() => {
            // a scanning row with no heartbeat for 30 minutes is a dead job —
            // report it failed so the page never spins forever
            const running = data.scan_status === 'scanning' || data.scan_status === 'queued'
            const stale = running && data.updated_at
              && Date.now() - new Date(data.updated_at).getTime() > 30 * 60_000
            return stale
              ? { status: 'failed', done: 0, total: 1, message: 'The scan stalled — upload the PDF again.' }
              : {
                  status: data.scan_status,
                  done: data.scan_done ?? 0,
                  total: data.scan_total ?? 1,
                  message: data.scan_message ?? null,
                }
          })()
        : null,
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
        return NextResponse.json({ error: 'That file is over 2GB.' }, { status: 413 })
      }
      const signed = await signUpload(String(body?.name ?? 'brand.pdf'), 'application/pdf')
      return NextResponse.json(signed)
    }

    // ── scan: hand the uploaded PDF to the background job ──
    if (body?.action === 'scan') {
      const url = String(body?.url ?? '')
      const filename = String(body?.filename ?? 'brand.pdf')
      if (!url.startsWith('https://')) {
        return NextResponse.json({ error: 'No uploaded document to scan' }, { status: 400 })
      }

      // mark it before dispatching, so the panel shows a scan in flight even
      // if the person navigates away a second later
      await supabase.from('client_brand').upsert({
        client_id: id, scan_status: 'queued', scan_done: 0, scan_total: 1,
        scan_message: null,
      })

      await inngest.send({
        name: 'app/brand.scan.requested',
        data: { clientId: id, url, filename, by: user.email },
      })

      // the document itself belongs in the client's `_Brand` folder — this is
      // the first point the server knows it exists and is uploaded (the sign
      // step above knows only a name and a size)
      mirrorBrandDoc(id, url, filename)

      // 202: accepted, not finished. The panel watches the brand channel and
      // fills itself in as chunks complete.
      return NextResponse.json({ queued: true }, { status: 202 })
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
