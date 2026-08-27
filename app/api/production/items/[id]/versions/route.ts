import { NextResponse } from 'next/server'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { addVersion, performTransition, type ContentItem } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { actingRoles, versionSatisfiesSubmission } from '../../../../../lib/workflow-core'
import { mirrorVersionSlides } from '../../../../../lib/gdrive-mirror'
import { normaliseSlides, slidesSatisfyType } from '../../../../../lib/version-files-core'

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
    // A version is a POST, and a post may be many files: `files` is the
    // ordered set of slides, `file_url` the one-file shape every older caller
    // still sends. Slide one IS file_url, so the two never disagree.
    const slides = normaliseSlides(
      Array.isArray(body.files) && body.files.length > 0
        ? body.files
        : body.file_url ? [{ url: String(body.file_url) }] : [],
    )
    // a version is the WORK: the file uploaded here, or a link to somewhere it
    // can be watched. The master-file link is optional — recording where the
    // full-quality original is filed is useful, not a precondition — so the
    // only thing refused is a version with nothing in it to look at.
    const check = versionSatisfiesSubmission({
      file_url: slides[0]?.url ?? '',
      drive_url: String(body.drive_url ?? ''),
      dropbox_url: String(body.dropbox_url ?? ''),
    })
    if (!check.ok) {
      return NextResponse.json({ error: `Add ${check.missing.join(' and ')}` }, { status: 422 })
    }
    // a carousel with one card is a photo post wearing a carousel's caption —
    // refused here rather than discovered when Instagram publishes one slide
    const shape = slidesSatisfyType(item.content_type as string, slides)
    if (shape) return NextResponse.json({ error: shape }, { status: 422 })

    const version = await addVersion(user, id, {
      file_url: slides[0]?.url ?? '',
      files: slides,
      dropbox_url: body.dropbox_url,
      drive_url: body.drive_url,
      notes: body.notes,
    })
    // EVERY slide goes into the item's Drive folder, numbered in posting
    // order; a version that is only a pasted link has no bytes of ours to copy
    mirrorVersionSlides(id, version.version_number as number, slides)

    // ── a new cut while the piece is WITH THE CLIENT ──
    //
    // The portal shows the latest client-facing version, so v2 saved now would
    // appear in front of the client with nobody having looked at it — and the
    // review card would go on inviting a decision about a piece that has since
    // changed. The item comes back for the manager's check instead. Only from
    // client_review: at client_changes_requested a new version is precisely
    // what was asked for, and it stays where it is.
    //
    // Never fatal. The version is saved and mirrored either way; a failure
    // here (a race with the manager's own click, most likely) leaves the item
    // where it was rather than losing the upload.
    let status = item.status as string
    if (item.status === 'client_review') {
      try {
        const moved = await performTransition(user, item as ContentItem, 'internal_review')
        status = moved.status
      } catch (e) {
        console.error('new version while with the client — could not send it back:', e)
      }
    }
    announceItemChange({ item_id: id, client_id: item.client_id, status, kind: 'version' })
    return NextResponse.json(version, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
}
