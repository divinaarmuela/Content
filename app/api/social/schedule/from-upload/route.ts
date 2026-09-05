import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { requireRole } from '@/app/lib/authz'
import { scheduleErrorResponse } from '@/app/lib/social-schedule'
import { createPostFromFiles } from '@/app/lib/schedule-upload'

// a version write mirrors its slides into Drive and asks for a video preview
// — the same shape of work the versions endpoint allows for
export const maxDuration = 300

/**
 * POST { client_id, files, caption?, scheduled_for?, timezone?, title? }
 *
 * A POST FROM A FILE, WITH NO PIECE NEEDED.
 *
 * The one door for "I have this photo and I want it up": the files are checked
 * against our own storage, the piece behind the post is created silently, the
 * upload becomes version 1, and the post comes back as a draft ready for the
 * composer. Who may skip the approval — and who is left waiting for the
 * manager's check — is decided in `createPostFromFiles`, off the same rule
 * every other surface asks (`mayPostWithoutApproval`).
 *
 * `requireRole('scheduler')` is the whole team floor, as everywhere else in
 * this feature; what a person may actually DO is decided per client and per
 * role inside the library, never here.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const body = await req.json().catch(() => ({}))
      const result = await createPostFromFiles(user, {
        client_id: String(body.client_id ?? ''),
        files: body.files,
        caption: body.caption ?? null,
        scheduled_for: body.scheduled_for ?? null,
        timezone: body.timezone ?? null,
        title: body.title ?? null,
      })
      return NextResponse.json({
        post: result.post,
        item_id: result.item.id,
        item_title: result.item.title,
        item_status: result.item.status,
        content_type: result.item.content_type,
        version_number: result.version_number,
        needs_approval: result.needs_approval,
        message: result.message,
      })
    } catch (e) {
      return scheduleErrorResponse(e)
    }
  })
}
