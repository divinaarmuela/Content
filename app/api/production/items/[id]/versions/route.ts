import { NextResponse } from 'next/server'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { addVersion } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { actingRoles, versionSatisfiesSubmission } from '../../../../../lib/workflow-core'
import { mirrorVersion } from '../../../../../lib/gdrive-mirror'

/** Append a new asset version (race-safe numbering). The editor HAT on this
 *  item — its owner, or anyone while it is unowned — plus managers. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // NOT requireRole('editor'): the editor HAT is an assignment, not a job
    // title, so a scheduler-role person who OWNS this item wears it. The
    // actingRoles check below is the real gate; a role floor here refused the
    // owner their own item and stranded it at draft forever.
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)
    // uploading a cut to someone else's assigned job is not a thing: hiding
    // the button is presentation, this is the rule
    const hats = actingRoles({ id: user.id, role: user.role }, item)
    if (!hats.some(h => h === 'editor' || h === 'account_manager' || h === 'super_admin')) {
      return NextResponse.json({ error: 'This job is assigned to someone else' }, { status: 403 })
    }
    const body = await req.json()
    // a version is the WORK: the file uploaded here, or a link to somewhere it
    // can be watched. The master-file link is optional — recording where the
    // full-quality original is filed is useful, not a precondition — so the
    // only thing refused is a version with nothing in it to look at.
    const check = versionSatisfiesSubmission({
      file_url: String(body.file_url ?? ''),
      drive_url: String(body.drive_url ?? ''),
      dropbox_url: String(body.dropbox_url ?? ''),
    })
    if (!check.ok) {
      return NextResponse.json({ error: `Add ${check.missing.join(' and ')}` }, { status: 422 })
    }
    const version = await addVersion(user, id, {
      file_url: body.file_url,
      dropbox_url: body.dropbox_url,
      drive_url: body.drive_url,
      notes: body.notes,
    })
    // the cut goes into the item's Drive folder as `v3 - <their name>`; a
    // version that is only a pasted link has no bytes of ours to copy
    mirrorVersion(id, version.version_number as number, version.file_url as string)
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'version' })
    return NextResponse.json(version, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
