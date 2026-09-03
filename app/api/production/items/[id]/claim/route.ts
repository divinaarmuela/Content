import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import { attachOne } from '@/lib/db-join'
import type { ContentItem, TeamUser } from '@/lib/db-types'
import { AuthzError, requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import {
  claimDecision, CLAIMABLE_SCHEDULING_STATUSES, EDITING_CLOSED_STATUSES, type ClaimHat,
} from '../../../../../lib/claim-core'
import { SHOOT_BRIEF_SLUG } from '../../../../../lib/brief-task-core'
import { isInternalKind } from '../../../../../lib/task-kind-core'
import { schedulerIdsOf, type ItemStatus } from '../../../../../lib/workflow-core'

/** Name a team member for a 409 message. Never their email — a colleague's
 *  address is not ours to hand out to explain a lost race. */
async function nameOf(id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const row = await table<TeamUser>('team_users').get(id)
  return row?.name?.trim() || null
}

/** A lost race, said plainly. */
function lost(name: string | null) {
  return NextResponse.json(
    {
      error: name ? `${name} took this a moment ago` : 'Someone already has this one',
      taken_by: name ?? 'Someone',
    },
    { status: 409 },
  )
}

/**
 * "I'll take this one."
 *
 * The open pool made explicit: an item nobody holds can be picked up, and
 * picking it up is what grants the hat. Two people clicking at the same
 * moment is the normal case, not the edge case — so the seat is checked
 * immediately before it is taken: still empty, AND the item still at a
 * status where the seat exists. A seat already filled means somebody else
 * got there first, and we say who.
 *
 * Self-assignment sends no email: you already know.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (user.role === 'client') {
      return NextResponse.json({ error: 'Client accounts cannot take on work' }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)

    const body = await req.json().catch(() => ({}))
    const hat = body?.hat as ClaimHat
    if (hat !== 'editor' && hat !== 'scheduler') {
      return NextResponse.json({ error: "hat must be 'editor' or 'scheduler'" }, { status: 400 })
    }

    // a shoot brief rides the item machine but is not open work
    const items = table<ContentItem>('content_items')
    const kindRow = (await attachOne([item], 'work_kind_id', 'work_kinds', ['slug', 'uses_media']))[0]
    const kind = kindRow.work_kinds as { slug?: string; uses_media?: boolean } | null
    const isBrief = (kind?.slug ?? null) === SHOOT_BRIEF_SLUG

    const decision = claimDecision(
      { status: item.status as ItemStatus, is_brief: isBrief, is_internal: isInternalKind(kind) },
      { id: user.id, role: user.role },
      hat,
    )
    if (!decision.ok) {
      return NextResponse.json({ error: decision.error }, { status: decision.status })
    }

    if (hat === 'editor') {
      let current: ContentItem | null
      try {
        current = await items.get(id)
      } catch (e) {
        console.error('claim (editor) failed:', (e as Error).message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
      // a transition landing between the read above and this write must not
      // hand the edit to someone on an item that has since been approved
      const seatOpen = !!current
        && current.owner_id == null
        && !(EDITING_CLOSED_STATUSES as readonly string[]).includes(current.status)
      if (!seatOpen) {
        // you already hold it — a second click, or two tabs. Not a conflict.
        if (current?.owner_id === user.id) return NextResponse.json({ ok: true, already: true })
        if (current?.owner_id) return lost(await nameOf(current.owner_id))
        return NextResponse.json(
          { error: 'This one moved on while you were looking — refresh and try again' },
          { status: 409 },
        )
      }
      try {
        await items.update(id, { owner_id: user.id, assigned_by: user.id } as Partial<ContentItem>)
      } catch (e) {
        console.error('claim (editor) failed:', (e as Error).message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
    } else {
      let current: ContentItem | null
      try {
        current = await items.get(id)
      } catch (e) {
        console.error('claim (scheduler) failed:', (e as Error).message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
      const holders = schedulerIdsOf(current ?? {})
      // still nobody's, and still at a status where there is scheduling to do.
      // The old write required scheduler_ids to be exactly []; an item that
      // never had the column written carries nothing at all, which is the
      // same "nobody holds it" and must claim just the same.
      const seatOpen = !!current
        && holders.length === 0
        && (CLAIMABLE_SCHEDULING_STATUSES as readonly string[]).includes(current.status)
      if (!seatOpen) {
        if (holders.includes(user.id)) return NextResponse.json({ ok: true, already: true })
        if (holders.length > 0) return lost(await nameOf(holders[0]))
        return NextResponse.json(
          { error: 'This one moved on while you were looking — refresh and try again' },
          { status: 409 },
        )
      }
      try {
        await items.update(id, { scheduler_ids: [user.id] })
      } catch (e) {
        console.error('claim (scheduler) failed:', (e as Error).message)
        throw new AuthzError('Could not pick this up — please try again', 500)
      }
    }

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'claimed',
      detail: hat === 'editor' ? 'picked up the edit' : 'picked up the scheduling',
    })
    announceItemChange({ item_id: id, client_id: item.client_id, status: item.status, kind: 'updated' })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
