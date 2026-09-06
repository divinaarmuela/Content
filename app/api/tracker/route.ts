import { NextRequest, NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../lib/authz'
import { createAsset, deleteAsset, listAssetsWithStats, updateAsset } from '../../lib/tracker'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireRole('editor')
    const clientId = req.nextUrl.searchParams.get('client_id')
    return NextResponse.json({ assets: await listAssetsWithStats(clientId) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireRole('editor')
    const body = await req.json()
    const title = String(body.title ?? '').trim().slice(0, 200)
    if (!title) return NextResponse.json({ error: 'Give the asset a title' }, { status: 400 })
    const asset = await createAsset({
      title,
      client_id: String(body.client_id ?? '').trim() || null,
      platform: String(body.platform ?? '').trim() || null,
      dest_url: String(body.dest_url ?? '').trim() || null,
      post_url: String(body.post_url ?? '').trim() || null,
      offer_code: String(body.offer_code ?? '').trim() || null,
      keyword: String(body.keyword ?? '').trim() || null,
    })
    return NextResponse.json({ asset }, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireRole('editor')
    const body = await req.json()
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    return NextResponse.json({ asset: await updateAsset(id, body) })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requireRole('super_admin')
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await deleteAsset(id)
    return NextResponse.json({ success: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
