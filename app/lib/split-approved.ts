import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { filesOf } from './drive-pull-core'
import { fileRound, roundOf } from './edit-round-core'
import { finalFilesOf } from './final-files-core'
import { clipApprovalsOf, captionsOf, type ClipApproval } from './clip-approvals-core'
import { approvedIdSet, handoffTitle, movedIdSet, splitApproved, versionSet } from './version-approval-core'
import { logActivity, performTransition } from './workflow'
import { announceItemChange } from './production-live'
import { clientManagers } from './posting-approval'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { itemPath } from './workflow-core'

/**
 * THE APPROVED CLIPS LEAVE WITH THEIR OWN CARD (the owner, 17 Sep 2026:
 * "approved assets don't get sent back to editors — approved goes into
 * handover with the same card data, which the AM or super admin can then
 * assign to a scheduler; the one that needs changing gets worked on by the
 * editor and goes through the same cycle" — and, 18 Sep 2026: "anything
 * approved goes to the handover immediately").
 *
 * While a card is with the client, every approval — the client's on the
 * portal, or a manager's on the card when the client said it in person —
 * is settled at once:
 *
 *   - some clips approved, some not → the approved ones move onto the card's
 *     HANDOVER CARD: the same client, title, brief, kind, people and dates,
 *     the files as its Version 1, their approvals and captions with them,
 *     stamped accepted, in For Handoff for a manager to hand to a scheduler.
 *     One handover card per edit: a later approval joins it until it is
 *     handed on, then a new one is opened;
 *   - every clip approved → nothing is split: the card itself is accepted
 *     (the client's approval logged), with whatever it still holds.
 *
 * The moved ids are written on the original card, and every reader (the
 * version tab, the portal, the share link) leaves them out from then on.
 * Best-effort: a failure here never fails the approval or the send-back —
 * it is logged and the manager can log the approval by hand.
 */
type VersionFile = { id: string; name: string; url: string; mime: string | null; size: number | null; version: number }

async function versionFilesOf(item: ContentItem): Promise<VersionFile[]> {
  const pulls = await table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never })
  return [
    ...finalFilesOf(item).map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? null, size: f.size ?? null, version: f.version })),
    ...pulls.filter(p => p.purpose === 'finished').flatMap(p => filesOf(p))
      .filter(f => f.status === 'done' && !!f.url)
      .map(f => ({ id: f.id, name: f.name, url: f.url as string, mime: f.mime ?? null, size: f.size ?? null, version: fileRound(f) })),
  ]
}

/** the card's open handover card — made by an earlier approval, not yet handed on */
async function openHandoverCardOf(item: ContentItem): Promise<ContentItem | null> {
  const rows = await table<ContentItem>('content_items').list({
    where: r => (r as { split_from?: unknown }).split_from === item.id && r.status === 'approved_for_scheduling'
      && !(Array.isArray((r as { scheduler_ids?: unknown }).scheduler_ids) && ((r as { scheduler_ids?: unknown[] }).scheduler_ids as unknown[]).length > 0),
    limit: 1,
  })
  return rows[0] ?? null
}

async function moveToHandover(actor: TeamUser | null, item: ContentItem, handoff: VersionFile[], remaining: number, round: number): Promise<{ id: string; moved: number }> {
  const now = new Date().toISOString()
  const approvals = clipApprovalsOf(item).filter(a => handoff.some(f => f.id === a.file_id))
  const captions = captionsOf(item)
  const movedCaptions = Object.fromEntries(handoff.filter(f => captions[f.id]).map(f => [f.id, captions[f.id]]))
  const files = handoff.map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? 'application/octet-stream', size: f.size ?? null, version: 1, uploaded_at: now, by: actor?.id ?? null }))
  const src = item as ContentItem & Record<string, unknown>
  const existing = await openHandoverCardOf(item)
  let card: ContentItem
  if (existing) {
    const have = new Set(finalFilesOf(existing).map(f => f.id))
    const merged = [...finalFilesOf(existing), ...files.filter(f => !have.has(f.id))]
    card = (await table<ContentItem>('content_items').update(existing.id, {
      final_files: merged,
      clip_approvals: [...clipApprovalsOf(existing).filter(a => !approvals.some(b => b.file_id === a.file_id)), ...approvals],
      asset_captions: { ...captionsOf(existing), ...movedCaptions },
      updated_at: now,
    } as never)) ?? existing
  } else {
    card = await table<ContentItem>('content_items').insert({
      client_id: item.client_id,
      title: handoffTitle(item.title, round),
      content_type: item.content_type ?? 'reel',
      platform_targets: Array.isArray(src.platform_targets) ? src.platform_targets : [],
      owner_id: item.owner_id ?? null,
      assigned_by: actor?.id ?? null,
      due_date: item.due_date ?? null,
      priority: (src.priority as string | null) ?? 'normal',
      caption: (src.caption as string | null) ?? null,
      brief: (src.brief as string | null) ?? null,
      work_kind_id: (src.work_kind_id as string | null) ?? null,
      batch_id: (src.batch_id as string | null) ?? null,
      group_id: (src.group_id as string | null) ?? null,
      for_contact_id: (src.for_contact_id as string | null) ?? null,
      client_approval_required: src.client_approval_required !== false,
      deliver_only: typeof src.deliver_only === 'boolean' ? src.deliver_only : null,
      status: 'approved_for_scheduling',
      current_version_number: 0,
      edit_round: 1,
      final_files: files,
      clip_approvals: approvals,
      asset_captions: movedCaptions,
      accepted_at: now,
      accepted_round: 1,
      split_from: item.id,
      created_at: now,
      updated_at: now,
    } as never)
  }

  await table<ContentItem>('content_items').update(item.id, {
    split_out: [...movedIdSet(item as never), ...handoff.map(f => f.id)],
    updated_at: now,
  } as never)

  const words = `${handoff.length} approved ${handoff.length === 1 ? 'clip' : 'clips'} moved to “${card.title}” for handover; ${remaining} ${remaining === 1 ? 'clip stays' : 'clips stay'} with the editor`
  await logActivity({ entityType: 'content_item', entityId: item.id, action: 'approved_clips_split', actor, detail: words })
  await logActivity({ entityType: 'content_item', entityId: card.id, action: 'card_made_from_approved_clips', actor, detail: existing ? `${handoff.length} more approved from “${item.title}” at Version ${round}` : `split from “${item.title}” at Version ${round}` })
  announceItemChange({ item_id: card.id, client_id: item.client_id, status: 'approved_for_scheduling', kind: existing ? 'updated' : 'created' })
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: String(item.status), kind: 'updated' })

  // THE MANAGERS ARE TOLD (the owner, 17 Sep 2026: "notifications in place"):
  // there is a card in For Handoff waiting for a scheduler
  try {
    const managers = await clientManagers(item.client_id)
    const subject = existing ? `More approved for handover: ${card.title}` : `Ready to hand over: ${card.title}`
    await Promise.all(managers.filter(m => m.id !== actor?.id).map(m => notify({
      actorName: actor?.name ?? 'The client', actorEmail: actor?.email ?? '', actorClerkId: actor?.clerk_user_id ?? null,
      eventType: 'approved_clips_split', entityType: 'content_item',
      entityId: `${card.id}#split#${m.id}#${handoff.map(f => f.id).join(',').slice(0, 80)}`,
      recipientId: m.id, recipientEmail: m.email,
      subject,
      bodyHtml: renderEmail(
        subject,
        `<p>${handoff.length} ${handoff.length === 1 ? 'clip' : 'clips'} on <strong>${escapeHtml(item.title)}</strong> ${handoff.length === 1 ? 'is' : 'are'} approved and ${existing ? 'joined' : 'now on'} <strong>${escapeHtml(card.title)}</strong> in For Handoff — hand it to a scheduler when you are ready.</p>`
        + `<p>${remaining} ${remaining === 1 ? 'clip stays' : 'clips stay'} with the editor for changes.</p>`,
        'Open the handover card',
        `${DASHBOARD_URL}${itemPath(card, (m as { role?: string | null }).role)}`,
      ),
    })))
  } catch (e) {
    console.error('[split-approved] could not tell the managers:', e)
  }
  return { id: card.id, moved: handoff.length }
}

/** SETTLE THE APPROVALS NOW (18 Sep 2026): called after every approval while
 *  the card is with the client. Some approved → they move to handover; all
 *  approved → the card is accepted. Nothing approved → nothing. */
export async function settleApprovals(actor: TeamUser | null, item: ContentItem): Promise<{ moved?: number; accepted?: boolean } | null> {
  if (!['client_review', 'client_changes_requested'].includes(String(item.status))) return null
  const approved = approvedIdSet(clipApprovalsOf(item))
  if (approved.size === 0) return null
  const round = roundOf(item as never)
  const version = versionSet(await versionFilesOf(item), round, approved, movedIdSet(item as never))
  const { handoff, remaining } = splitApproved(version, approved)
  if (handoff.length === 0) return null
  if (remaining.length === 0) {
    // EVERYTHING APPROVED — the card itself is accepted (the client's approval logged)
    if (!actor) return null
    try {
      await performTransition(actor, item as never, 'approved_for_scheduling', { note: 'Every clip approved' })
      return { accepted: true }
    } catch (e) {
      console.error('[split-approved] could not accept the fully approved card:', e)
      return null
    }
  }
  const done = await moveToHandover(actor, item, handoff, remaining.length, round)
  return { moved: done.moved }
}

/** AT A SEND-BACK (17 Sep 2026): whatever approved clips are still on the
 *  card leave with it — usually none, since approvals are settled as they land. */
export async function splitApprovedClips(user: TeamUser, item: ContentItem): Promise<{ id: string; moved: number } | null> {
  const approved = approvedIdSet(clipApprovalsOf(item))
  if (approved.size === 0) return null
  const round = roundOf(item as never)
  const version = versionSet(await versionFilesOf(item), round, approved, movedIdSet(item as never))
  const { handoff, remaining } = splitApproved(version, approved)
  if (handoff.length === 0 || remaining.length === 0) return null
  return moveToHandover(user, item, handoff, remaining.length, round)
}

export type { ClipApproval }
