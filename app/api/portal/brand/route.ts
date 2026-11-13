import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { portalOwnerByToken } from '../../../lib/portal-owner'
import { headStoredObject, signUpload } from '../../../lib/storage'
import { brandAssetProblem, MAX_BRAND_ASSET_BYTES } from '../../../lib/brand-assets-core'
import { addClientBrandFile, loadPortalBrandFiles, tellManagersOfBrandFiles } from '../../../lib/brand-assets'

/**
 * BRAND ASSETS FROM THE PORTAL (the owner, 13 Nov 2026). The client adds brand files from their portal's Brand assets
 * tab. Token-bearer like every portal route: the link is the only authorisation, so the kind and size of file are
 * decided here, never trusted from the browser, and only the business's own link may add (a person's link cannot).
 *
 *   sign  → a one-hour address the browser uploads ONE file straight to storage with (the bytes never pass through us)
 *   add   → the uploaded files go onto the brand's file list, once storage confirms each is really there
 */

export const dynamic = 'force-dynamic'

const STORAGE_BASE = () => String(process.env.R2_PUBLIC_BASE_URL ?? '').replace(/\/$/, '')

export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const owner = await portalOwnerByToken(String(body?.token ?? ''))
    if (!owner) return NextResponse.json({ error: 'Invalid link' }, { status: 401 })
    if (owner.scope.kind !== 'business') return NextResponse.json({ error: 'Brand files are added from the business’s own portal link' }, { status: 403 })
    const clientId = owner.client.id

    if (body?.action === 'sign') {
      const name = String(body?.name ?? '').trim().slice(0, 200)
      const size = Number(body?.size ?? 0)
      const problem = brandAssetProblem(name, size)
      if (problem) return NextResponse.json({ error: problem }, { status: size > MAX_BRAND_ASSET_BYTES ? 413 : 415 })
      const signed = await signUpload(name, String(body?.type || 'application/octet-stream'))
      return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: signed.publicUrl })
    }

    if (body?.action === 'add') {
      const who = String(body?.who ?? '').trim().slice(0, 80) || owner.client.name
      const asked = (Array.isArray(body?.files) ? body!.files as unknown[] : []).slice(0, 20)
        .map(f => ({ name: String((f as { name?: unknown })?.name ?? '').trim().slice(0, 200), url: String((f as { url?: unknown })?.url ?? '') }))
      const base = STORAGE_BASE()
      const added: string[] = []
      for (const f of asked) {
        // only an address in OUR storage, with a name of a kind we take, and only once the file is really there
        if (!base || !f.url.startsWith(`${base}/`) || /[?#]/.test(f.url)) return NextResponse.json({ error: 'That file was not uploaded here' }, { status: 400 })
        const stored = await headStoredObject(f.url)
        if (!stored) return NextResponse.json({ error: `${f.name || 'A file'} did not finish uploading. Please add it again.` }, { status: 409 })
        const problem = brandAssetProblem(f.name, stored.bytes ?? 1)
        if (problem) return NextResponse.json({ error: problem }, { status: 415 })
        const res = await addClientBrandFile(clientId, f, who)
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 })
        if (res.added) added.push(f.name)
      }
      await tellManagersOfBrandFiles(clientId, owner.client.name, who, added)
      return NextResponse.json({ added: added.length, files: await loadPortalBrandFiles(clientId) })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Something went wrong' }, { status: 500 })
  }
  })
}
