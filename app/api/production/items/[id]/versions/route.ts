import { NextResponse } from 'next/server'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { addVersion } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { actingRoles } from '../../../../../lib/workflow-core'

/** Append a new asset version (race-safe numbering). The editor HAT on this
 *  item — its owner, or anyone while it is unowned — plus managers. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRole('editor')
    const { id } = await params
    const item = await loadItemForUser(user, id)
    // uploading a cut to someone else's assigned job is not a thing: hiding
    // the button is presentation, this is the rule
    const hats = actingRoles({ id: user.id, role: user.role }, item)
    if (!hats.some(h => h === 'editor' || h === 'account_manager' || h === 'super_admin')) {
      return NextResponse.json({ error: 'This job is assigned to someone else' }, { status: 403 })
    }
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
