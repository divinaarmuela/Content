import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { DriveSeen, DriveSource } from '@/lib/db-types'
import { authzErrorResponse, requireRole } from '@/app/lib/authz'
import { loadItemForUser } from '@/app/lib/production-access'
import { startDriveHandIn } from '@/app/lib/drive-handin'
import { canEditItemFields } from '@/app/lib/item-edit-core'
import { gradeSinceOf } from '@/app/lib/drive-scan'
import { gradeStanding } from '@/app/lib/drive-scan-core'

/**
 * THE EDITOR PREVIEW: CONFIRM OR SET ASIDE WHAT THE AI FOUND IN DRIVE (step 3, the owner, 22 Oct 2026).
 *
 *   confirm — the files become a hand-in on the card, through the SAME hand-in the live Editor uses
 *             (drive-handin.startDriveHandIn): each file to the video the AI matched it to, or a new video. The
 *             hand-in's own rules hold (who may hand in at which stage, one copying at a time).
 *   ignore  — "not this": the files are set aside and never offered again.
 *
 * WHO MAY: exactly who may hand in on the live Editor (api/production/items/[id]/drive-handin) — whoever holds the
 * card, a manager, or the colourist at colour grade. The new Editor is the Editor now (the owner, 22 Oct 2026: "new
 * editor page takes place"), so this works on every card. Every row change is a claim (trap 11).
 */
export const dynamic = 'force-dynamic'

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
    try {
      const user = await requireRole('scheduler')
      const { id } = await ctx.params
      const item = await loadItemForUser(user, id)
      if (!item) return NextResponse.json({ error: 'No such card' }, { status: 404 })
      const body = await req.json().catch(() => ({})) as { seen_ids?: unknown; action?: unknown }
      const action = body.action === 'ignore' ? 'ignore' : body.action === 'confirm' ? 'confirm' : null
      const ids = Array.isArray(body.seen_ids) ? body.seen_ids.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
      if (!action || !ids.length) return NextResponse.json({ error: 'Say which files, and confirm or ignore' }, { status: 400 })
      const grades = (user as { colourist?: unknown }).colourist === true && String(item.status ?? '') === 'colour_grade'
      if (!canEditItemFields(user, item as never) && !grades) {
        return NextResponse.json({ error: 'Only whoever holds this card — or a manager — can hand in its files' }, { status: 403 })
      }
      const rows = (await Promise.all(ids.map(r => table<DriveSeen>('drive_seen').get(r)))).filter((r): r is DriveSeen => !!r && r.item_id === item.id)
      if (!rows.length) return NextResponse.json({ error: 'Those files are not on this card' }, { status: 404 })
      const now = new Date().toISOString()
      const settle = (state: 'taken' | 'ignored') => Promise.all(rows.map(r => table<DriveSeen>('drive_seen').claim(r.id, cur =>
        cur && ['scanned', 'locked', 'failed', 'new'].includes(cur.state) ? { ...cur, state, decided_by: user.id, decided_at: now, updated_at: now } as DriveSeen : null)))

      if (action === 'ignore') {
        await settle('ignored')
        return NextResponse.json({ ok: true, ignored: rows.length })
      }

      // ANOTHER CARD'S VIDEO IS NEVER HANDED IN HERE — the card points to where it is instead (the owner, 22 Oct 2026)
      const theirs = rows.find(r => (r.scan as { other_card?: { title?: string } | null } | null)?.other_card)
      if (theirs) {
        const title = (theirs.scan as { other_card: { title?: string } }).other_card.title ?? 'another card'
        return NextResponse.json({ error: `${theirs.name} is already on “${title}” — open that card to add it there.` }, { status: 409 })
      }
      // AT COLOUR GRADE ONLY A GRADE IS HANDED IN: a file that was in Drive before the card went there (an editor's
      // re-cut) is not the colourist's work (the owner, 22 Oct 2026)
      if (String(item.status) === 'colour_grade') {
        const since = await gradeSinceOf(item.id)
        for (const r of rows) {
          const src = await table<DriveSource>('drive_sources').get(r.source_id)
          if (gradeStanding(r, src?.created_at, since) !== 'grade') {
            return NextResponse.json({ error: `${r.name} was in Drive before this card went to colour grade — it isn't a grade. Send the card back to editing if it is a new cut.` }, { status: 409 })
          }
        }
      }
      // one hand-in per Drive link the files came from, each file to the video the AI matched (or a new video)
      const bySource = new Map<string, DriveSeen[]>()
      for (const r of rows) bySource.set(r.source_id, [...(bySource.get(r.source_id) ?? []), r])
      const started: string[] = []
      for (const [sourceId, group] of bySource) {
        const source = await table<DriveSource>('drive_sources').get(sourceId)
        if (!source) continue
        const map: Record<string, string> = {}
        for (const r of group) {
          const a = (r.scan as { asset?: string | null } | null)?.asset ?? null
          // a card video's id goes to that video; a match in Drive or on another card is a new video here
          map[r.drive_file_id] = a && !a.startsWith('seen:') && !a.startsWith('card:') ? a : 'new'
        }
        const res = await startDriveHandIn(user, item as never, { url: source.link, ids: group.map(r => r.drive_file_id), map })
        if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
        started.push(sourceId)
      }
      await settle('taken')
      return NextResponse.json({ ok: true, handed_in: rows.length, links: started.length })
    } catch (e) {
      const { error, status } = authzErrorResponse(e)
      return NextResponse.json({ error }, { status })
    }
  })
}
