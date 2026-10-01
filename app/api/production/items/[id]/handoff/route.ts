import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamUser } from '@/lib/db-types'
import { requireRole, authzErrorResponse, AuthzError } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, notifyScheduleHandoff, performTransition } from '../../../../../lib/workflow'
import { announceItemChange } from '../../../../../lib/production-live'
import { createBatchForCard } from '../../../../../lib/post-batch'

/** Hand an approved item to specific schedulers — the follow-up to a client
 *  approval, where the fan-out went to everyone and the manager narrows it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    // managers, super admins — and the general role, who may make and post
    // a card and so may hand one on (the tutorial walk of 11 Sep 2026: the
    // board offered "Hand to…" and this route answered 403)
    const user = await requireRole('scheduler')
    if (!['account_manager', 'super_admin', 'general'].includes(user.role)) {
      throw new AuthzError('Handing a card on is for managers and general users', 403)
    }
    const { id } = await params
    let item = await loadItemForUser(user, id)
    const body = await req.json()
    // APPROVED AND HANDED IN ONE MOVE (the owner, 15 Sep 2026: "it should not
    // go to Ready to post on the approval page first"): with `approve`, the
    // same edge the Approve button pressed is performed here — its history,
    // the client's decision recorded, the managers told — and the card goes
    // on into the scheduler's Draft below, never resting at Ready to post.
    // The schedulers are NOT told "it needs a posting date": the one it is
    // handed to is told, once, that it is theirs to work on. The pick is
    // checked first, so an empty pick approves nothing.
    const approve = body.approve === true && !['approved_for_scheduling', 'scheduled'].includes(item.status)
    // approved OR already scheduled: re-handing a scheduled item to someone
    // else to publish is a real need, not an edge case. A published one is done.
    if (!approve && !['approved_for_scheduling', 'scheduled'].includes(item.status)) {
      return NextResponse.json(
        { error: 'Only an approved or scheduled item can be handed to someone' },
        { status: 400 },
      )
    }
    const ids: string[] = Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Pick at least one person' }, { status: 400 })
    }

    // anyone on the team can be handed the scheduling now — the hat follows
    // the assignment, not the job title. Only a real, active, non-client
    // account survives: a stale id must never be persisted as an assignee.
    const wanted = ids.slice(0, 20)
    const people = await table<TeamUser>('team_users').list({ where: u => wanted.includes(u.id) })
    const valid = people
      .filter(u => u.active_status && u.role !== 'client')
      .map(u => u.id)
    if (valid.length === 0) {
      return NextResponse.json({ error: 'Pick at least one active team member' }, { status: 400 })
    }

    if (approve) {
      item = await performTransition(user, item as never, 'approved_for_scheduling', {
        skipAudiences: ['assigned_schedulers', 'schedulers'],
        // the card goes to the person picked here — never also to the client's default scheduler
        callerHandsOver: true,
      }) as unknown as typeof item
    }
    // INTO THE SCHEDULER'S DRAFT, NOT READY TO POST (the owner, 14 Sep 2026:
    // "handing over to a scheduler should go in Draft — the drive files are
    // what they work from"). The handed folder and the editor's edit stay on
    // the card as the source; the scheduler produces the post and sends it
    // for the quality check. A card the scheduler only has to book (already
    // scheduled) is left where it is.
    const patch: Record<string, unknown> = { scheduler_ids: valid }
    const toDraft = item.status === 'approved_for_scheduling'

    // THE CARD ITSELF, AS A BATCH (the owner, 1 Oct 2026; was one post with the first file, 30 Sep 2026):
    // one fresh DRAFT post per approved file — a carousel's pictures stay one post — on Post approval,
    // assigned to the first person it was handed to. Made while the card is still approved (the files'
    // sign-off is read off it). Each draft is claimed under the card, version and file, so a second
    // hand-over or a retry makes nothing twice. The edit card stays on the Editor page.
    let postIds: string[] = []
    let postProblem: string | null = null
    if (toDraft) {
      try {
        const batch = await createBatchForCard(item as never, { scheduler: valid[0] })
        if (batch.ok) postIds = batch.postIds
        else postProblem = batch.reason
      } catch (e) {
        postProblem = e instanceof Error ? e.message : 'The posts could not be made'
      }
    }
    if (toDraft) patch.status = 'draft_uploaded'
    // ONE WINNER (trap 11): the card moves only from the status this request read — a hand-over that
    // landed first (the automatic one, or a second press) keeps the card, and its posts are the same posts
    const from = item.status
    const landed = await table('content_items').claim(id, cur =>
      (cur && cur.status === from ? { ...cur, ...patch } : null))
    if (!landed.claimed) {
      return NextResponse.json({ error: 'This card was just handed over by someone else — refresh to see who has it' }, { status: 409 })
    }
    // the one notice for the batch, to each person handed it — sent only by the hand-over that landed
    const sent = await notifyScheduleHandoff(user, item, valid, toDraft ? 'work' : 'schedule',
      toDraft && postIds.length > 0 ? { posts: postIds.length } : undefined)
    announceItemChange({ item_id: id, client_id: item.client_id, status: toDraft ? 'draft_uploaded' : item.status, kind: 'updated' })

    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'schedule_handoff',
      detail: `${approve ? 'approved and ' : ''}handed to ${valid.length} person${valid.length === 1 ? '' : 's'} (${sent} notified)${postIds.length > 0 ? ` — ${postIds.length} draft post${postIds.length === 1 ? '' : 's'}` : ''}`,
    })
    const first = people.find(u => u.id === valid[0])
    return NextResponse.json({
      notified: sent,
      post_id: postIds[0] ?? null,
      post_ids: postIds,
      posts: postIds.length,
      handed_to: first ? (first.name || first.email) : null,
      ...(postProblem ? { post_problem: postProblem } : {}),
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
