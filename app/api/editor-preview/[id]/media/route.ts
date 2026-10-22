import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { DriveSeen, VideoFrame } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { finalFilesOf } from '@/app/lib/final-files-core'
import { framesRowId } from '@/app/lib/scan-measure'
import { gradeSinceOf } from '@/app/lib/drive-scan'

/**
 * WHAT ONE EDITOR CARD NEEDS BESIDE ITS OWN ROW, in one small answer (live, 22 Oct 2026: the card page read the whole
 * activity history — 2,600 rows, about 1 MB — and every video's frames to draw one card, and took ~15 s to open):
 *   - when the card last went to Colour grade (after it, a new file is a grade);
 *   - the frames and storyboard of each of its videos — on the card and in its Drive links;
 *   - the files found in OTHER cards' Drive links that the AI matched to a video on THIS card, so this card can offer
 *     them (the owner: "prompt the card there … so when they click it takes them there").
 */
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await ctx.params
      const item = await loadItemForUser(user, id)
      if (!item) return NextResponse.json({ error: 'No such card' }, { status: 404 })
      const seen = await table<DriveSeen>('drive_seen').list()
      const own = seen.filter(r => r.item_id === id)
      const incoming = seen.filter(r => r.item_id !== id && ['scanned', 'taken'].includes(r.state)
        && (r.scan as { other_card?: { id?: string } | null; kind?: string } | null)?.other_card?.id === id
        && (r.scan as { kind?: string }).kind !== 'copy')
      const driveKey = (r: DriveSeen) => `drive:${r.drive_file_id}:${r.md5 ?? r.revision ?? `${r.size}@${r.modified}`}`
      const keys = [...new Set([
        ...finalFilesOf(item as never).map(f => `r2:${f.url}`),
        ...[...own, ...incoming].map(driveKey),
      ])]
      const rows = await Promise.all(keys.map(k => table<VideoFrame>('video_frames').get(framesRowId(k)).catch(() => null)))
      const media: Record<string, { frames: { url: string; at_s: number }[]; board: unknown }> = {}
      rows.forEach((r, i) => {
        if (!r) return
        const frames = (Array.isArray(r.frames) ? r.frames as { url?: string | null; at_s?: number }[] : []).filter(f => f.url).map(f => ({ url: String(f.url), at_s: Number(f.at_s ?? 0) }))
        media[keys[i]] = { frames, board: (r as { storyboard?: unknown }).storyboard ?? null }
      })
      // THE SAME DRIVE FILE ON TWO CARDS (live, 22 Oct 2026: Ryan added Alia's whole folder to Product Photos/Videos and
      // Travel Vlogs' files showed there as new): a file another card met first is that card's — named, not offered
      const items = await table<{ id: string; title?: string | null }>('content_items').list()
      const title = new Map(items.map(i => [i.id, String(i.title ?? 'another card')]))
      const ownedElsewhere: Record<string, { id: string; title: string }> = {}
      for (const r of own) {
        const first = seen.filter(x => x.drive_file_id === r.drive_file_id && x.item_id !== id && x.first_seen_at < r.first_seen_at && !['ignored', 'gone'].includes(x.state))
          .sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at))[0]
        if (first) ownedElsewhere[r.drive_file_id] = { id: first.item_id, title: title.get(first.item_id) ?? 'another card' }
      }
      return NextResponse.json({ gradeSince: await gradeSinceOf(id), media, incoming, ownedElsewhere })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
