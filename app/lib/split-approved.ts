import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { filesOf } from './drive-pull-core'
import { fileRound, roundOf } from './edit-round-core'
import { finalFilesOf } from './final-files-core'
import { clipApprovalsOf } from './clip-approvals-core'
import { approvedIdSet, handoffTitle, movedIdSet, splitApproved, versionSet } from './version-approval-core'
import { logActivity } from './workflow'
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
 * editor and goes through the same cycle").
 *
 * Called once a card is sent back from the client's stage. When SOME of the
 * version's clips are approved and some are not, the approved ones are moved
 * onto a new card — the same client, title, brief, kind, people and dates,
 * the files themselves as its Version 1, their approvals with them, stamped
 * accepted — sitting in For Handoff for a manager to hand to a scheduler.
 * The original card keeps only what needs work: the moved ids are written
 * on it, and every reader (the version tab, the portal, the share link)
 * leaves them out from then on.
 *
 * Nothing happens when nothing is approved (the whole version goes back)
 * or when everything is (the whole card is accepted instead). Best-effort:
 * a failure here never fails the send-back — it is logged and the manager
 * can log the approval by hand.
 */
export async function splitApprovedClips(user: TeamUser, item: ContentItem): Promise<{ id: string; moved: number } | null> {
  const round = roundOf(item as never)
  const approved = approvedIdSet(clipApprovalsOf(item))
  if (approved.size === 0) return null
  const moved = movedIdSet(item as never)
  const pulls = await table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never })
  const all = [
    ...finalFilesOf(item).map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? null, size: f.size ?? null, version: f.version })),
    ...pulls.filter(p => p.purpose === 'finished').flatMap(p => filesOf(p))
      .filter(f => f.status === 'done' && !!f.url)
      .map(f => ({ id: f.id, name: f.name, url: f.url as string, mime: f.mime ?? null, size: f.size ?? null, version: fileRound(f) })),
  ]
  const version = versionSet(all, round, approved, moved)
  const { handoff, remaining } = splitApproved(version, approved)
  if (handoff.length === 0 || remaining.length === 0) return null

  const now = new Date().toISOString()
  const approvals = clipApprovalsOf(item).filter(a => handoff.some(f => f.id === a.file_id))
  const src = item as ContentItem & Record<string, unknown>
  const card = await table<ContentItem>('content_items').insert({
    client_id: item.client_id,
    title: handoffTitle(item.title, round),
    content_type: item.content_type ?? 'reel',
    platform_targets: Array.isArray(src.platform_targets) ? src.platform_targets : [],
    owner_id: item.owner_id ?? null,
    assigned_by: user.id,
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
    final_files: handoff.map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? 'application/octet-stream', size: f.size ?? null, version: 1, uploaded_at: now, by: user.id })),
    clip_approvals: approvals,
    accepted_at: now,
    accepted_round: 1,
    split_from: item.id,
    created_at: now,
    updated_at: now,
  } as never)

  await table<ContentItem>('content_items').update(item.id, {
    split_out: [...moved, ...handoff.map(f => f.id)],
    updated_at: now,
  } as never)

  const words = `${handoff.length} approved ${handoff.length === 1 ? 'clip' : 'clips'} moved to “${card.title}” for handover; ${remaining.length} ${remaining.length === 1 ? 'clip stays' : 'clips stay'} with the editor`
  await logActivity({ entityType: 'content_item', entityId: item.id, action: 'approved_clips_split', actor: user, detail: words })
  await logActivity({ entityType: 'content_item', entityId: card.id, action: 'card_made_from_approved_clips', actor: user, detail: `split from “${item.title}” at Version ${round}` })
  announceItemChange({ item_id: card.id, client_id: item.client_id, status: 'approved_for_scheduling', kind: 'created' })
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: String(item.status), kind: 'updated' })

  // THE MANAGERS ARE TOLD (the owner, 17 Sep 2026: "notifications in place"):
  // there is a card in For Handoff waiting for a scheduler
  try {
    const managers = await clientManagers(item.client_id)
    const subject = `Ready to hand over: ${card.title}`
    await Promise.all(managers.filter(m => m.id !== user.id).map(m => notify({
      actorName: user.name, actorEmail: user.email, actorClerkId: user.clerk_user_id,
      eventType: 'approved_clips_split', entityType: 'content_item',
      entityId: `${card.id}#split#${m.id}`,
      recipientId: m.id, recipientEmail: m.email,
      subject,
      bodyHtml: renderEmail(
        subject,
        `<p>The client approved ${handoff.length} of the ${version.length} ${version.length === 1 ? 'clip' : 'clips'} on <strong>${escapeHtml(item.title)}</strong>.</p>`
        + `<p>Those ${handoff.length === 1 ? 'clip is' : 'clips are'} now on their own card, <strong>${escapeHtml(card.title)}</strong>, in For Handoff — hand it to a scheduler when you are ready. The other ${remaining.length} ${remaining.length === 1 ? 'clip stays' : 'clips stay'} with the editor for changes.</p>`,
        'Open the handover card',
        `${DASHBOARD_URL}${itemPath(card, (m as { role?: string | null }).role)}`,
      ),
    })))
  } catch (e) {
    console.error('[split-approved] could not tell the managers:', e)
  }
  return { id: card.id, moved: handoff.length }
}
