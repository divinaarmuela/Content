import { NextResponse } from 'next/server'
import { table, withRequestCache } from '@/lib/db'
import type { ContentItem, TeamUser } from '@/lib/db-types'
import { requireSignedIn, authzErrorResponse } from '../../../../../lib/authz'
import { loadItemForUser } from '../../../../../lib/production-access'
import { logActivity, performTransition, type ContentItem as WorkflowItem } from '../../../../../lib/workflow'
import { notify, renderEmail, escapeHtml } from '../../../../../lib/mailer'
import { OPEN_ITEM_CTA } from '../../../../../lib/email-voice-core'
import { announceItemChange } from '../../../../../lib/production-live'
import { canReadClientComments } from '../../../../../lib/comment-access-core'
import { actingRoles, STATUS_LABELS, type ItemStatus } from '../../../../../lib/workflow-core'
import { canMoveTo, columnOf } from '../../../../../lib/board-core'

const DASHBOARD_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

/**
 * SEND BACK FOR CHANGES — the manager's words go to the person who must act.
 *
 * The owner's rule: "if needs changes can send back to the person assigned,
 * send them what needs changing". The account manager reads the client's
 * thread (which the assignee never sees), writes what needs changing in
 * their own words, and this route:
 *
 *   1. moves the card to Internal check through the ORDINARY transitions —
 *      from With client that is "Log the client's changes" and then "Send
 *      for revision"; from anywhere else in the funnel it is the one edge
 *      into `revision_required` the manager holds. `canMoveTo` picks the
 *      status exactly as a drag on the board would, so nothing here can move
 *      a card a button could not;
 *   2. writes the words ON THE CARD (`change_note`) and into the card's own
 *      thread, tagged to the assignee, so they see exactly what to change
 *      without ever reading the client's thread;
 *   3. tells the assignee — bell and email, one `notify()` — with the words
 *      in the message. `EMAIL_TEST_ONLY` is honoured inside `notify()`.
 *
 * The transition's own fan-out to the owner is skipped so they hear once, in
 * the manager's words, not twice. Never check-then-write: the transition
 * carries its own optimistic guard and refuses a stale card with a 409.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestCache(async () => {
  try {
    const user = await requireSignedIn()
    if (!canReadClientComments(user.role)) {
      return NextResponse.json({ error: 'Only an account manager can send a card back' }, { status: 403 })
    }
    const { id } = await params
    const item = await loadItemForUser(user, id)
    const body = await req.json().catch(() => ({}))
    const note = String(body?.note ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000)
    if (!note) return NextResponse.json({ error: 'Say what needs changing first' }, { status: 400 })

    const hats = actingRoles({ id: user.id, role: user.role }, item)
    let current = item as unknown as WorkflowItem
    const steps: { from: ItemStatus; to: ItemStatus; label: string }[] = []

    // With client, still waiting on the client → first log that the client
    // wants changes, the same edge the button uses. Only then is the edge
    // into Internal check open to the manager.
    if (current.status === 'client_review') {
      const moved = await performTransition(user, current, 'client_changes_requested', {
        skipAudiences: ['account_managers'],
      })
      steps.push({ from: 'client_review', to: 'client_changes_requested', label: "Log the client's changes" })
      current = { ...current, ...moved, status: moved.status }
    }

    if (columnOf(current.status) !== 'internal_check') {
      // the drop a drag onto Internal check would make — same rules, same status
      const decision = canMoveTo({ status: current.status }, 'internal_check', hats)
      if (!decision.ok) return NextResponse.json({ error: decision.reason }, { status: 403 })
      const moved = await performTransition(user, current, decision.to, {
        note,
        // the assignee hears from THIS route, once, in the manager's words
        skipAudiences: ['owner_editor'],
      })
      steps.push({ from: current.status, to: decision.to, label: decision.label })
      current = { ...current, ...moved, status: moved.status }
    } else if (current.status !== 'revision_required') {
      // already in Internal check but not yet being revised (waiting for the
      // manager's check, or revised and waiting again): "Ask for changes" is
      // the edge, and the machine decides whether this person holds it
      const moved = await performTransition(user, current, 'revision_required', {
        note, skipAudiences: ['owner_editor'],
      })
      steps.push({ from: current.status, to: 'revision_required', label: 'Ask for changes' })
      current = { ...current, ...moved, status: moved.status }
    }
    // revision_required already: the card is being revised — the words are
    // added to it and the assignee told again, no move needed

    const now = new Date().toISOString()
    await table<ContentItem>('content_items').update(id, {
      change_note: note, change_note_by: user.id, change_note_at: now,
    })

    // the words in the card's own thread, tagged to the assignee so they sit
    // in the assignee's narrowed view of it
    const ownerId = (current.owner_id ?? item.owner_id ?? null) as string | null
    try {
      await table('item_comments').insert({
        item_id: id, author_id: user.id, visibility: 'internal', body: note,
        assigned_to: ownerId, resolved: false,
      })
    } catch (e) {
      console.error('send-back: could not write the note to the thread', e instanceof Error ? e.message : e)
    }
    await logActivity({
      actor: user, clientId: item.client_id,
      entityType: 'content_item', entityId: id,
      action: 'sent_back', detail: note.slice(0, 500),
    })

    // tell the person assigned — bell and email in one notify()
    let notified: { id: string; name: string } | null = null
    if (ownerId && ownerId !== user.id) {
      const owner = await table<TeamUser>('team_users').get(ownerId)
      if (owner && owner.active_status !== false && owner.role !== 'client') {
        const subject = `${item.title} — what needs changing`
        const result = await notify({
          actorName: user.name,
          actorEmail: user.email,
          actorClerkId: user.clerk_user_id,
          eventType: 'sent_back',
          entityType: 'content_item',
          // keyed on this send: the same words sent twice is one message,
          // a second round of changes is another
          entityId: `${id}#${now}`,
          recipientId: owner.id,
          recipientEmail: owner.email,
          subject,
          bodyHtml: renderEmail(
            subject,
            `<p><strong>${escapeHtml(item.title)}</strong> is back with you. ${escapeHtml(user.name || user.email)} says:</p>` +
            `<blockquote style="margin:12px 0;padding:8px 14px;border-left:3px solid #e4e4e7;color:#3f3f46;">${escapeHtml(note)}</blockquote>` +
            `<p><strong>What happens next:</strong> make the changes, then hand it on for checking. It is now “${escapeHtml(STATUS_LABELS[current.status])}”.</p>`,
            OPEN_ITEM_CTA,
            `${DASHBOARD_URL}/dashboard/production/${id}`,
          ),
        })
        if (result !== 'failed') notified = { id: owner.id, name: owner.name || owner.email }
      }
    }

    announceItemChange({ item_id: id, client_id: item.client_id, status: current.status, kind: 'transition' })
    return NextResponse.json({
      ok: true,
      status: current.status,
      column: columnOf(current.status),
      steps,
      notified,
      change_note: note,
    })
  } catch (e) {
    const { error, status } = authzErrorResponse(e)
    return NextResponse.json({ error }, { status })
  }
  })
}
