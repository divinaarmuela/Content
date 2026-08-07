import { NextResponse } from 'next/server'
import { getIntakeByToken, addIntakeFile } from '../../../../lib/intake'
import { signUpload } from '../../../../lib/storage'
import { isWritable } from '../../../../lib/intake-core'

/**
 * Presigned upload for a file block.
 *
 * The uploader is not logged in — the token is the only authorisation — so the
 * type and size limits are enforced here rather than trusted from the browser.
 */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024
// brand assets: logos, a PDF style guide, a zip of fonts. Not video.
const ALLOWED = /^(image\/|application\/pdf$|application\/zip$|application\/x-zip-compressed$|font\/)/

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const form = await getIntakeByToken(token)
  if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isWritable(form.status)) {
    return NextResponse.json({ error: 'This form has already been submitted' }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  const filename = String(body?.filename ?? '').slice(0, 200)
  const contentType = String(body?.contentType ?? '')
  const size = Number(body?.size ?? 0)
  const blockId = String(body?.blockId ?? '')

  if (!filename || !blockId) {
    return NextResponse.json({ error: 'filename and blockId are required' }, { status: 400 })
  }
  // the block must exist in THIS form, or the token becomes a way to write
  // arbitrary rows against it
  const known = form.definition.sections.some(s => s.blocks.some(b => b.id === blockId && b.type === 'file'))
  if (!known) return NextResponse.json({ error: 'Unknown upload field' }, { status: 400 })

  if (!ALLOWED.test(contentType)) {
    return NextResponse.json({ error: 'That file type is not accepted here' }, { status: 415 })
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: 'Files must be under 50MB' }, { status: 413 })
  }

  const signed = await signUpload(filename, contentType)
  await addIntakeFile(form.id, blockId, filename, signed.publicUrl, size)
  return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: signed.publicUrl })
}
