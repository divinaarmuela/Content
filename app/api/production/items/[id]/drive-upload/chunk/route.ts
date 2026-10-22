import { NextResponse } from 'next/server'
import { table } from '@/lib/db'
import type { DriveUpload } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { cardUploadRow } from '@/app/lib/card-upload'
import { cardFilingAllowed, PROXY_CHUNK } from '@/app/lib/card-upload-core'
import { pushUploadChunk } from '@/app/lib/gdrive-files'

/**
 * ONE PIECE OF A CARD UPLOAD, THROUGH OUR SERVER — the fallback for a browser that may not send to Google itself.
 * `?upload=<id>&offset=<byte>`, the piece as the body (4 MB at most). The answer is Google's count, never ours.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('scheduler')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    if (!cardFilingAllowed((item as { client_id?: string }).client_id)) return NextResponse.json({ error: 'Not on for this client' }, { status: 403 })
    const url = new URL(req.url)
    const row = await cardUploadRow(url.searchParams.get('upload') ?? '', user, id)
    const start = Number(url.searchParams.get('offset') ?? '0')
    if (!row || row.status !== 'open' || !Number.isFinite(start) || start < 0) {
      return NextResponse.json({ error: 'That upload is no longer going' }, { status: 404 })
    }
    const bytes = new Uint8Array(await req.arrayBuffer())
    if (bytes.length > PROXY_CHUNK) return NextResponse.json({ error: 'That piece was too big' }, { status: 413 })
    const out = await pushUploadChunk(row.upload_uri, bytes, start, row.size ?? null)
    if (!out.ok) return NextResponse.json({ error: out.message }, { status: 502 })
    const now = new Date().toISOString()
    if (out.done) {
      await table<DriveUpload>('drive_uploads').update(row.id, { status: 'done', drive_file_id: out.id, received: out.bytes, updated_at: now } as Partial<DriveUpload>)
      return NextResponse.json({ done: true, received: out.bytes })
    }
    await table<DriveUpload>('drive_uploads').update(row.id, { received: out.received, updated_at: now } as Partial<DriveUpload>)
    return NextResponse.json({ done: false, received: out.received })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
