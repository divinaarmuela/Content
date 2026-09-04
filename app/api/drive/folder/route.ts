import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { findOrCreateFolder } from '../../../lib/gdrive-files'
import { requireFilesAccess } from '../../../lib/drive-page'
import { isDriveId } from '../../../lib/files-core'

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
    await requireFilesAccess()
    const body = await req.json().catch(() => ({})) as { parent?: string; name?: string }
    if (!isDriveId(body.parent)) {
      return NextResponse.json({ error: 'That folder could not be found' }, { status: 400 })
    }
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Give the folder a name first' }, { status: 400 })

    const result = await findOrCreateFolder(body.parent, name)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })
    return NextResponse.json({ id: result.id, created: result.created })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
