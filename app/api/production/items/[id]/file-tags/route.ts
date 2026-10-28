import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { announceItemChange } from '../../../../../lib/production-live'
import { assetIdOf, finalFilesOf } from '../../../../../lib/final-files-core'
import { cleanTag, withAssetTag } from '../../../../../lib/file-tags-core'

/**
 * POST { file_id, tag, on } — A TAG ON ONE OF THE CARD'S VIDEOS, put on or taken off (the owner, 28 Oct 2026: "allow
 * to add a tag in the editor files anytime"). Anyone on the team who can open the card. Written on every version of
 * the video, through a claim, so two people tagging at once do not wipe each other's (trap 11). "Posted" from the app
 * is worked out on the page, never written here.
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler') // the team floor: editors, schedulers, managers
      const { id } = await params
      await loadItemForUser(user, id)
      const body = await req.json().catch(() => ({})) as { file_id?: unknown; tag?: unknown; on?: unknown }
      const tag = cleanTag(body.tag)
      if (!tag) return NextResponse.json({ error: 'Type a tag' }, { status: 400 })
      const on = body.on !== false
      const fileId = String(body.file_id ?? '')
      let missing = false
      const res = await table<ContentItem>('content_items').claim(id, cur => {
        if (!cur) return null
        const file = finalFilesOf(cur as never).find(f => f.id === fileId)
        if (!file) { missing = true; return null }
        return { ...cur, final_files: withAssetTag(finalFilesOf(cur as never), assetIdOf(file), tag, on) as never, updated_at: new Date().toISOString() }
      })
      if (missing) return NextResponse.json({ error: 'That video is not on this card any more' }, { status: 404 })
      if (!res.claimed) return NextResponse.json({ error: 'The card changed as you saved — try again' }, { status: 409 })
      announceItemChange({ item_id: id, client_id: res.row.client_id, status: String(res.row.status), kind: 'updated' })
      return NextResponse.json({ ok: true, tag, on })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
