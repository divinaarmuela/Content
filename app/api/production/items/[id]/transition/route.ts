import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { TeamUser } from '@/lib/db-types'
import { requireSignedIn, requireRole, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { performTransition } from '../../../../../lib/workflow'
import { ITEM_STATUSES, type ItemStatus } from '../../../../../lib/workflow-core'
import { finishedEditOf } from '../../../../../lib/card-link-core'
import { startPullSoon } from '../../../../../lib/drive-pull'
import { SENT_BACK_STATUSES, handInRound } from '../../../../../lib/edit-round-core'
import { finalFilesOf, stillToReplace, currentFiles, assetIdOf, hasFinishedWork } from '../../../../../lib/final-files-core'

/** Execute a status transition. Role legality, requirement evidence, and the
 *  optimistic-concurrency guard all live in performTransition. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json()
    const to = body.to as ItemStatus
    if (!(ITEM_STATUSES as readonly string[]).includes(to)) {
      return NextResponse.json({ error: 'Invalid target status' }, { status: 400 })
    }
    // scheduler assignment is a TEAM decision — a client-role caller (the
    // portal approves through this machinery) must not be able to pick who
    // schedules or narrow another scheduler's queue
    const requestedSchedulerIds = user.role !== 'client' && Array.isArray(body.scheduler_ids)
      ? body.scheduler_ids.map((v: unknown) => String(v)).filter(Boolean).slice(0, 20)
      : undefined
    // …and only REAL people: the same validation the handoff route does. A
    // stale or client id persisted as an assignee would hand the scheduling
    // hat to an account that can never wear it, and quietly empty the queue
    // it was taken out of.
    let schedulerIds: string[] | undefined
    if (requestedSchedulerIds?.length) {
      const wanted: string[] = requestedSchedulerIds
      const people = await table<TeamUser>('team_users').list({ where: u => wanted.includes(u.id) })
      const valid = people
        .filter(u => u.active_status && u.role !== 'client')
        .map(u => u.id)
      if (valid.length === 0) {
        return NextResponse.json({ error: 'Pick at least one active team member' }, { status: 400 })
      }
      schedulerIds = valid
    }
    // A SENT-BACK CLIP NEEDS ITS NEW CUT BEFORE THE CARD GOES BACK (24 Sep 2026). The drawer said so; nothing
    // enforced it, and Jordan Wilson's card went to quality check with Script 1 and Script 5 never re-cut.
    if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check' && finalFilesOf(item as never).length > 0) {
      const waiting = stillToReplace(item as never)
      if (waiting.length > 0) {
        const names = currentFiles(item as never).filter(f => waiting.includes(assetIdOf(f))).map(f => f.name)
        return NextResponse.json({ error: `${names.join(', ')} ${names.length === 1 ? 'still needs its' : 'still need their'} new version — upload ${names.length === 1 ? 'it' : 'them'} on the card first` }, { status: 409 })
      }
    }
    // …AND A CARD HANDED IN BY DRIVE, SENT BACK, COMES BACK AS FILES (the owner, 25 Sep 2026: "existing cards that
    // have drives, if sent back, only allowed to submit files, not a link anymore"): its old finished link used to count
    // as the revision, so a whole-card send-back could be resubmitted with nothing new on it
    if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check'
      && (finalFilesOf(item as never).length > 0 || (item as { link_final?: boolean | null }).link_final === true)
      && !hasFinishedWork(item as never)) {
      return NextResponse.json({ error: 'Upload the new files on the card first — a Drive link is only the folder to work from' }, { status: 409 })
    }
    const note = String(body.note ?? '').trim().slice(0, 2000)
    const updated = await performTransition(user, item, to, {
      reviewerIds: Array.isArray(body.notify_ids) ? body.notify_ids : undefined,
      schedulerIds,
      note: note || undefined,
    })
    // REVISIONS DONE IS THE NEXT VERSION'S HAND-IN (the owner, 16 Sep 2026:
    // "version 1 is the first time they send the finished link; sent back,
    // they make changes and send again — that's version 2"): the round goes
    // up on the card, and the finished edit's folder is read again as that
    // round, so the new cut's files come in as version N
    if (SENT_BACK_STATUSES.includes(String(item.status)) && to === 'quality_check') {
      const round = handInRound(item)
      await table('content_items').update(id, { edit_round: round })
      const finished = finishedEditOf(item as never)
      // a card whose hand-in is files has nothing to copy from Drive — it copied the folder again as
      // Version 2 beside the uploads (seen live, 22 Sep 2026: 20 pulled files for a card of 11)
      if (finished && finalFilesOf(item as never).length === 0) startPullSoon({ kind: 'item', scopeId: id, folderUrl: finished.url, version: round, by: user.id, purpose: 'finished' })
    }
    // the note also lands in the item's own thread, tagged to the owner so
    // it stays visible in their narrowed view even when the requester isn't
    // their assignor — best-effort, never fails the transition
    if (note) {
      // …except on the client's own change request: that edge notifies account
      // managers and NEVER the editor directly (workflow-core), and a tagged
      // comment emails whoever it names. Leave it untagged so the rule holds.
      const clientChanges = item.status === 'client_review' && to === 'client_changes_requested'
      // A client's note is a note to US, and visibility follows the author's
      // role exactly as it does on the comments route: they must be able to see
      // what they sent. A client also never assigns — a note filed against the
      // editor would email them directly, past the gatekeeper.
      const fromClient = user.role === 'client'
      try {
        await table('item_comments').insert({
          item_id: id, author_id: user.id,
          visibility: fromClient ? 'client' : 'internal', body: note,
          assigned_to: fromClient || clientChanges ? null : item.owner_id ?? null,
          // an unstamped boolean reads back as absent, and every "still open"
          // filter tests `resolved === false`
          resolved: false,
        })
      } catch { /* best-effort: the note never fails the transition */ }
    }
    // an approve-with-picker is also an assignment: the chosen schedulers'
    // dashboards show this item, others' stay clear
    if (to === 'approved_for_scheduling' && schedulerIds?.length) {
      await table('content_items').update(id, { scheduler_ids: schedulerIds })
    }
    return NextResponse.json(updated)
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    // a refused move leaves its reason in the deployment log, so "did not
    // notify" can be read as "was refused, because …" (14 Sep 2026: two 400s
    // on one card with no reason in sight)
    console.warn('transition refused', { status, error, path: new URL(req.url).pathname })
    return NextResponse.json({ error }, { status })
  }
  })
}
