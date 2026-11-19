import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { AuthzError, authzErrorResponse, requireRole } from '@/app/lib/authz'
import { accessibleClientIds } from '@/app/lib/production-access'
import { mayOpenReports } from '@/app/lib/client-report-core'
import { putObject, r2Configured } from '@/app/lib/storage'

/**
 * A PICTURE FOR A REPORT (the owner, 19 Nov 2026: "why can't I … add images"). The report editor sends a picture here
 * and gets back the address it is kept at; the report's document holds only that address.
 *
 *   POST  form: client_id, file   →  { url }
 *
 * WHO: the same people as the report itself — super admins, and account managers for their own clients.
 * WHAT: a PNG, JPEG or WebP of at most 4 MB. The editor shrinks a picture before sending it (a phone photo is far
 * larger than a report needs, and a request here cannot carry more than about 4.5 MB). Never an SVG: an SVG can carry
 * script.
 */
export const dynamic = 'force-dynamic'

const KINDS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 4 * 1024 * 1024

export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('account_manager')
      if (!mayOpenReports(user.role)) throw new AuthzError('Reports are for super admins and account managers', 403)
      const form = await req.formData().catch(() => null)
      const clientId = String(form?.get('client_id') ?? '')
      const file = form?.get('file')
      if (!clientId || !(file instanceof File)) return NextResponse.json({ error: 'Pick a picture to add' }, { status: 400 })
      const ids = await accessibleClientIds(user)
      if (ids !== null && !ids.includes(clientId)) throw new AuthzError('That client is not one of yours', 403)
      const ext = KINDS[file.type]
      if (!ext) return NextResponse.json({ error: 'Use a PNG, JPEG or WebP picture' }, { status: 415 })
      if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That picture is too large. Use one under 4 MB.' }, { status: 413 })
      if (!r2Configured()) return NextResponse.json({ error: 'File storage is not configured' }, { status: 503 })
      const bytes = Buffer.from(await file.arrayBuffer())
      const name = createHash('sha1').update(bytes).digest('hex').slice(0, 24)
      const { publicUrl } = await putObject(`report-img-${name}.${ext}`, bytes, file.type)
      return NextResponse.json({ url: publicUrl })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
