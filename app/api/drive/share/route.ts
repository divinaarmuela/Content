import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { shareableLink } from '../../../lib/gdrive-files'
import { requireFilesAccess } from '../../../lib/drive-page'
import { confirmRefusal, isDriveId } from '../../../lib/files-core'

/**
 * A link anybody holding it can open.
 *
 * Behind the same confirmation as a rename, and for the same reason: this
 * changes who may see one of the owner's files, which is not something a page
 * should be able to do quietly. The dialog says what it means in plain words —
 * "Anyone with this link will be able to open it" — and only pressing the
 * button sets `confirm: true`.
 *
 * Reader, never writer, and never discoverable by search.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    await requireFilesAccess()
    const body = await req.json().catch(() => ({})) as { id?: string; confirm?: unknown }

    const refusal = confirmRefusal(body)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })
    if (!isDriveId(body.id)) {
      return NextResponse.json({ error: 'That file could not be found' }, { status: 400 })
    }

    const result = await shareableLink(body.id)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })
    return NextResponse.json({ url: result.url })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
