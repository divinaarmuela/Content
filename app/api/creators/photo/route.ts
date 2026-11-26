import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { putObject, r2Configured } from '../../../lib/storage'
import { asTeam, isManager } from '../respond'

/**
 * A CREATOR'S PHOTO. POST form: file → { url }. Managers only. A PNG, JPEG or WebP of at most 4 MB (a request here
 * cannot carry more than about 4.5 MB); never an SVG, which can carry script. The campaign keeps only the address.
 */
export const dynamic = 'force-dynamic'

const KINDS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_BYTES = 4 * 1024 * 1024

export function POST(req: Request) {
  return asTeam(async v => {
    if (!isManager(v)) return NextResponse.json({ error: 'Photos are added by managers' }, { status: 403 })
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Pick a photo to add' }, { status: 400 })
    const ext = KINDS[file.type]
    if (!ext) return NextResponse.json({ error: 'Use a PNG, JPEG or WebP photo' }, { status: 415 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photo is too large. Use one under 4 MB.' }, { status: 413 })
    if (!r2Configured()) return NextResponse.json({ error: 'File storage is not configured' }, { status: 503 })
    const bytes = Buffer.from(await file.arrayBuffer())
    const name = createHash('sha1').update(bytes).digest('hex').slice(0, 24)
    const { publicUrl } = await putObject(`creator-photo-${name}.${ext}`, bytes, file.type)
    return NextResponse.json({ url: publicUrl })
  })
}
