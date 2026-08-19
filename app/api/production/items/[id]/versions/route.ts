import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { addVersion } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'

/** Append a new asset version (race-safe numbering). editor+. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    const version = await addVersion(user, id, {
      file_url: body.file_url,
      dropbox_url: body.dropbox_url,
      drive_url: body.drive_url,
      notes: body.notes,
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'version' })
    return NextResponse.json(version, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
