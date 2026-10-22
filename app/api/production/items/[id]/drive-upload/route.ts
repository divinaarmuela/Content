import { NextResponse } from 'next/server'
import { withRequestCache } from '@/lib/db'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { cardUploadState, finishCardUploads, makeCardFolder, renameCardFolder, startCardUpload } from '@/app/lib/card-upload'

/**
 * THE CARD'S DRIVE UPLOAD (card-upload-core.ts has the why; card-upload.ts the Drive writes).
 *
 *   GET                                  the folder, the version, its folders, this person's unfinished files
 *   POST { action: 'start', name, size, mime, parent? }   a resumable session into V{n} (or a folder inside it) —
 *                                        the same file picked again carries on where it stopped
 *   POST { action: 'finish', uploads }   the finished files go on the card (the Drive hand-in)
 *   POST { action: 'folder', parent?, name }   a new folder inside the card's folder
 *   POST { action: 'rename', id, name }  rename a folder inside it — never V1 / V2
 *
 * WHO: anyone on the team who can open the card (the owner, 22 Oct 2026: "in any step of this cards anyone should be
 * able to swap in a new version"). Test clients only until DRIVE_CARD_FILING=all.
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      return NextResponse.json(await cardUploadState(user, item as never))
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      const body = await req.json().catch(() => ({})) as Record<string, unknown>
      const answer = body.action === 'start'
        ? await startCardUpload(user, item as never, body, req.headers.get('origin'))
        : body.action === 'finish'
          ? await finishCardUploads(user, item as never, body.uploads)
          : body.action === 'folder'
            ? await makeCardFolder(item as never, body.parent, body.name)
            : body.action === 'rename'
              ? await renameCardFolder(item as never, body.id, body.name)
              : { ok: false as const, status: 400, error: 'Unknown action' }
      if (!answer.ok) return NextResponse.json({ error: answer.error }, { status: answer.status })
      return NextResponse.json(answer)
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
