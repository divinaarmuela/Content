import { NextResponse } from 'next/server'
import { DbError, table, withRequestCache } from '@/lib/db'
import type { WorkKind as WorkKindRow } from '@/lib/db-types'
import { requireRole, authzErrorResponse } from '../../../../lib/authz'
import { logActivity } from '../../../../lib/workflow'
import { findKindByName, kindSlugOf, normaliseKindName } from '../../../../lib/work-kinds-core'

/**
 * FREE-TEXT WORK KINDS: typing a kind that does not exist creates it.
 *
 * The owner's words: "kind is FREE TEXT. Typing a new one adds it for next
 * time." A card's kind box takes whatever the person types; this route turns
 * the words into a `work_kinds` row — adopting the one that already matches
 * ("Odd Job" and "odd job" are one kind), and only otherwise adding one.
 *
 * NEVER CHECK-THEN-WRITE. The lookup is a courtesy; the guarantee is the
 * unique slug. Two people typing the same new kind at once both miss the
 * lookup and both insert — the database lets exactly one in, and the loser
 * reads the winner's row back. One row, always.
 *
 * Any team member may do this: an editor or a scheduler makes cards too, and
 * a kind is a word on a card, not a permission.
 */
export async function POST(req: Request) {
  return withRequestCache(async () => {
  try {
    const user = await requireRole('scheduler')
    const body = await req.json().catch(() => ({}))
    const name = normaliseKindName(body?.name)
    if (!name) return NextResponse.json({ error: 'Type a kind of work first' }, { status: 400 })
    const slug = kindSlugOf(name)

    const kinds = table<WorkKindRow>('work_kinds')
    const existing = findKindByName(await kinds.list({ fresh: true }), name)
    if (existing) {
      // adopted. An archived kind somebody just typed is wanted again.
      if (existing.active === false) {
        const revived = await kinds.update(existing.id, { active: true })
        return NextResponse.json({ kind: revived ?? existing, created: false, revived: true })
      }
      return NextResponse.json({ kind: existing, created: false })
    }

    let created: WorkKindRow
    try {
      const count = await kinds.count()
      created = await table('work_kinds').insert({
        slug, name,
        // a typed kind is ordinary work: shown to editors first, carries media
        // like any other card, and wears the plain colour until somebody picks one
        default_roles: ['editor'], uses_media: true, color: 'zinc',
        active: true, sort_order: count,
      }) as unknown as WorkKindRow
    } catch (e) {
      if (!(e instanceof DbError && e.code === 'unique')) throw e
      // somebody typed the same kind a moment ago — adopt theirs
      const winner = (await kinds.list({ fresh: true })).find(k => k.slug === slug) ?? null
      if (!winner) throw e
      return NextResponse.json({ kind: winner, created: false })
    }
    await logActivity({
      actor: user, entityType: 'work_kind', entityId: created.id,
      action: 'created', newValue: created.name, detail: 'typed on a card',
    })
    return NextResponse.json({ kind: created, created: true }, { status: 201 })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
