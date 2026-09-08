import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { AssetVersion } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { upsertScheduleEntry } from '../../../../../lib/schedule'
import { postedSlidesFor, recordPublishOnItem } from '../../../../../lib/production-publish'
import { fullyPosted, postedProgress, readPostedSlides } from '../../../../../lib/posted-slides-core'
import { slidesOf } from '../../../../../lib/version-files-core'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'

/**
 * POST { url, live_url?, platform?, posted_at? } — ONE FILE OF A PIECE, POSTED BY HAND.
 *
 * The owner, 9 Sep 2026: "if Ready to post, one of the assets can be done
 * as a manual post, to prove it's posted." The file is marked posted on the
 * card (`posted_slides`), with the live link when there is one. When that
 * makes the whole piece posted, the ordinary publish path runs — a schedule
 * row and the move to Posted — exactly as if the last post had gone out
 * through the app.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await params
      const item = await loadItemForUser(user, id)
      const body = await req.json().catch(() => ({})) as { url?: unknown; live_url?: unknown; platform?: unknown; posted_at?: unknown }
      const url = String(body.url ?? '').trim()
      if (!url) throw new AuthzError('Say which file', 400)
      const versions = await table<AssetVersion>('asset_versions').list({ by: { item_id: id } })
      const latest = [...versions].sort((a, b) => Number(b.version_number ?? 0) - Number(a.version_number ?? 0))[0] ?? null
      const slides = slidesOf(latest)
      if (!slides.some(s => s.url === url)) throw new AuthzError('That file is not on this piece any more', 409)

      const prev = readPostedSlides((item as { posted_slides?: unknown }).posted_slides)
      const byHand = [...new Set([...(prev?.urls ?? []), url])]
      const liveUrl = typeof body.live_url === 'string' && body.live_url.trim() ? body.live_url.trim() : null
      // WHEN it went out — the person's word, or now; a time that cannot be
      // read, or one in the future, is refused rather than guessed at
      const at = typeof body.posted_at === 'string' && body.posted_at ? new Date(body.posted_at) : new Date()
      if (!Number.isFinite(at.getTime())) throw new AuthzError('That is not a time we can read', 400)
      if (at.getTime() > Date.now() + 60_000) throw new AuthzError('That time has not come yet — a post marked by hand has already gone out', 400)
      const hand = { ...(prev?.hand ?? {}), [url]: { at: at.toISOString(), link: liveUrl } }
      const progress = postedProgress(slides, new Set(), byHand, hand)
      await table('content_items').update(id, { posted_slides: progress })
      const index = slides.findIndex(s => s.url === url) + 1
      await logActivity({
        actor: user, clientId: item.client_id, entityType: 'content_item', entityId: id,
        action: 'posted_by_hand', newValue: `${index} of ${slides.length}`,
        detail: `posted ${at.toISOString()}${liveUrl ? ` · ${liveUrl}` : ''}`,
      })

      if (fullyPosted(progress)) {
        const platform = typeof body.platform === 'string' && body.platform ? body.platform : 'instagram'
        await upsertScheduleEntry(user, item, {
          platform, scheduled_at: at.toISOString(),
          ...(liveUrl ? { live_url: liveUrl } : { mark_posted: true }),
        })
        await recordPublishOnItem(id, liveUrl, [platform])
      } else {
        announceItemChange({ item_id: id, client_id: item.client_id, status: String(item.status), kind: 'updated' })
      }
      return NextResponse.json({ ok: true, posted: (await postedSlidesFor(id, { posted_slides: progress })) })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
