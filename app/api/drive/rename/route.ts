import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { entryDetail, renameDriveItem } from '../../../lib/gdrive-files'
import { recordRename, requireFilesAccess } from '../../../lib/drive-page'
import { confirmRefusal, isDriveId } from '../../../lib/files-core'
import { readOnlyRefusal } from '../../../lib/gdrive-policy'

/**
 * Rename ONE thing in the owner's Drive, because a person asked for it.
 *
 * Three refusals stand between a request and a change to somebody's files:
 *
 *  1. `confirm: true` or nothing happens. The dialog that sets it names the
 *     item out loud ("Rename “Sui Kitchen” to …?"). A drag, a sweep or a retry
 *     cannot produce that flag, which is the point — the owner's rule is that
 *     nothing is ever renamed as a side effect of something else.
 *  2. One id, never a list. There is no bulk rename here and there is not
 *     meant to be one.
 *  3. A failure is reported as it happened. Nothing retries under a different
 *     name; "the rename failed so we invented a name" is how a folder ends up
 *     called something nobody chose.
 *
 * The `drive_files` write afterwards changes nothing in Drive — it records
 * what a person just did, so the mirror and the page agree about the name.
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
    const body = await req.json().catch(() => ({})) as
      { id?: string; name?: string; confirm?: unknown }

    const refusal = confirmRefusal(body)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

    if (!isDriveId(body.id)) {
      return NextResponse.json({ error: 'That file could not be found' }, { status: 400 })
    }
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Give it a name first' }, { status: 400 })

    // read it first so the reply can say what it used to be called — the
    // undo a person does by hand starts with knowing the old name
    const before = await entryDetail(body.id)
    if (!before.ok) return NextResponse.json({ error: before.message }, { status: 502 })

    const result = await renameDriveItem(body.id, name)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: 502 })

    await recordRename(body.id, result.name)
    return NextResponse.json({ id: body.id, was: before.entry.name, name: result.name })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
