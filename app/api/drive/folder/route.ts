import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { findOrCreateFolder } from '../../../lib/gdrive-files'
import { outsideHqRefusal, requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'
import { readOnlyRefusal } from '../../../lib/gdrive-policy'

/**
 * Make a folder — or find the one that is already there.
 *
 * ADOPT, NEVER DUPLICATE. Drive has no unique-name constraint: press this
 * twice, or have two people press it at once, and without the find-first it
 * would leave two folders with the same name in the same place and nobody able
 * to say which one the work went into. That is the failure the owner named
 * explicitly, so it is a property of the route and of the helper under it, not
 * a habit of the page.
 *
 * `created: false` is a success, and the page says "That folder is already
 * there" rather than claiming to have made something.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    // FIRST, before the role check and before the body is read: the dashboard
    // does not write to Google Drive. The code below still works and is still
    // tested — DRIVE_PAGE_WRITES=1 puts it back — but nothing on any page can
    // reach it, and a request that arrives anyway is refused here.
    const readOnly = readOnlyRefusal()
    if (readOnly) return NextResponse.json({ error: readOnly }, { status: 403 })

    await requireFilesAccess()
    const body = await req.json().catch(() => ({})) as { parent?: string; name?: string }
    if (!isDriveId(body.parent)) {
      return NextResponse.json({ error: 'That folder could not be found' }, { status: 400 })
    }
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Give the folder a name first' }, { status: 400 })

    // additive, so the blast radius is small — but "this page only ever writes
    // inside HQ" should be a property of the routes, not a habit of the UI
    const outside = await outsideHqRefusal(body.parent)
    if (outside) return NextResponse.json({ error: outside.error }, { status: outside.status })

    const result = await findOrCreateFolder(body.parent, name)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })
    return NextResponse.json({ id: result.id, created: result.created })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
