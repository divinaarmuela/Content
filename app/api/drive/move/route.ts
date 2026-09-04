import { NextResponse } from 'next/server'
import { authzErrorResponse } from '../../../lib/authz'
import { entryDetail, isInside, moveDriveFile } from '../../../lib/gdrive-files'
import { outsideHqRefusal, recordMove, requireFilesAccess } from '../../../lib/drive-page'
import { confirmRefusal, isDriveId } from '../../../lib/files-core'
import { readOnlyRefusal } from '../../../lib/gdrive-policy'

/**
 * Move things into a folder, because a person dragged them there and then
 * said yes.
 *
 * The drag is not the decision. Dropping something opens a question that names
 * what is being moved and where it is going, and only pressing Move sets
 * `confirm: true` — without it this route changes nothing at all. That is the
 * owner's rule made mechanical: a file in their Drive never moves as a side
 * effect of a gesture, a sync or a retry.
 *
 * Three guards beyond the confirmation. The target must be inside the folder
 * the owner chose, so nothing on this page can file one of their archive files
 * out of MD Media HQ; a folder cannot go inside itself; and a folder cannot go
 * inside one of its own folders — Drive would accept that one and the whole
 * branch would vanish out of the tree with no way to find it again. All three
 * refuse on "could not check" rather than assuming the answer is no.
 *
 * Every move is reported individually. A batch that half worked has to say
 * which half, or the person is left to work it out by looking.
 */
export const dynamic = 'force-dynamic'

const MAX_AT_ONCE = 50

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
      { ids?: unknown; to?: string; confirm?: unknown }

    const refusal = confirmRefusal(body)
    if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

    if (!isDriveId(body.to)) {
      return NextResponse.json({ error: 'That folder could not be found' }, { status: 400 })
    }
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    if (!ids.length) return NextResponse.json({ error: 'Nothing was picked up.' }, { status: 400 })
    if (ids.length > MAX_AT_ONCE) {
      return NextResponse.json(
        { error: `Move up to ${MAX_AT_ONCE} things at a time.` }, { status: 400 },
      )
    }
    if (ids.some(id => !isDriveId(id))) {
      return NextResponse.json({ error: 'One of those files could not be found' }, { status: 400 })
    }
    if (ids.includes(body.to)) {
      return NextResponse.json({ error: 'A folder cannot go inside itself.' }, { status: 400 })
    }

    // the target has to be inside the folder the owner chose. The dialog's
    // picker is rooted there, but the picker is presentation and this is the
    // gate: any team member can post a `to` of their own, and `drive.file`
    // reaches further than HQ.
    const outside = await outsideHqRefusal(body.to)
    if (outside) return NextResponse.json({ error: outside.error }, { status: outside.status })
    // "I could not check" is not "no". A transient Drive 500, a folder deeper
    // than the walk allows, or an ancestor the `drive.file` grant does not
    // cover all used to read as safe — and permitting a folder into its own
    // child is the one action on this page that cannot be taken back.
    for (const id of ids) {
      const where = await isInside(body.to, id)
      if (where === 'inside') {
        return NextResponse.json(
          { error: 'A folder cannot go inside one of its own folders.' }, { status: 400 },
        )
      }
      if (where === 'unknown') {
        return NextResponse.json(
          { error: 'Could not check that folder just now — try again.' }, { status: 503 },
        )
      }
    }

    const moved: string[] = []
    const failed: { id: string; name: string | null; error: string }[] = []
    for (const id of ids) {
      const detail = await entryDetail(id)
      const name = detail.ok ? detail.entry.name : null
      const result = await moveDriveFile(id, body.to)
      if (!result.ok) {
        // fail safe: say what happened, leave everything else alone, and never
        // try the same move a second way
        console.error('[drive/move] refused by Google:', result.message)
        failed.push({ id, name, error: result.message })
        continue
      }
      await recordMove(id, body.to)
      moved.push(id)
    }

    return NextResponse.json({ moved, failed })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
