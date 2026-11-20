import { NextResponse } from 'next/server'
import { getIntakeByToken, addIntakeFile } from '../../../../lib/intake'
import { signUpload } from '../../../../lib/storage'
import { isWritable } from '../../../../lib/intake-core'
import { brandAssetProblem } from '../../../../lib/brand-assets-core'

/**
 * Presigned upload for a file block.
 *
 * The uploader is not logged in — the token is the only authorisation — so the
 * type and size limits are enforced here rather than trusted from the browser.
 */

export const dynamic = 'force-dynamic'

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

  // EVERY INTAKE FORM TAKES WHAT THE CLIENT BRAND TAB TAKES (the owner, 20 Nov 2026: "50 mb only??? … files are usually
  // bigger … how come in client branding tab I can upload more than that? … make sure normal intake form does the
  // same, for all 4 options"): 1 GB a file, and the same kinds — pictures, PDF, AI, EPS, PSD, fonts, a zip, a video.
  // It was 50MB and a shorter list. Judged by the file's name, as the Brand tab does: a design file often arrives
  // with no type at all. One rule, in one place (brand-assets-core.ts), because these files end up on that tab.
  const why = brandAssetProblem(filename, size)
  if (why) return NextResponse.json({ error: why }, { status: 415 })

  const signed = await signUpload(filename, contentType || 'application/octet-stream')
  await addIntakeFile(form.id, blockId, filename, signed.publicUrl, size)
  return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: signed.publicUrl })
}
