import 'server-only'
import { table } from '@/lib/db'
import type { ContentItem, DrivePull, ItemComment } from '@/lib/db-types'
import type { TeamUser } from './authz'
import { filesOf } from './drive-pull-core'
import { fileRound, roundOf } from './edit-round-core'
import { finalFilesOf } from './final-files-core'
import { clipApprovalsOf, captionsOf, qcApprovalsOf, type ClipApproval } from './clip-approvals-core'
import { approvedIdSet, handoffTitle, movedIdSet, splitApproved, toClientTitle, versionSet } from './version-approval-core'
import { logActivity, performTransition } from './workflow'
import { announceItemChange } from './production-live'
import { clientManagers } from './posting-approval'
import { escapeHtml, notify, renderEmail } from './mailer'
import { DASHBOARD_URL } from './app-url'
import { itemPath } from './workflow-core'

/**
 * ASSETS MOVE ON ONE BY ONE (the owner, 17–18 Sep 2026: "approved assets
 * don't get sent back to editors — approved goes into handover with the same
 * card data"; "the approve during quality review means it goes to the client
 * now … then the same process, but this time the AM can see and approve …
 * once some are approved with the client they go into handover, and the
 * other needs to get sent back; same for designers").
 *
 * Two stages settle the same way, one asset at a time:
 *
 *   AT THE QUALITY CHECK — the reviewer (or a super admin) passes assets one
 *   by one. Each passed asset leaves at once for a TO-THE-CLIENT card: the
 *   same client, title, brief, kind, people and dates, the passed files as
 *   its Version 1, sent to the client the normal way (so the client and the
 *   managers are told, and the portal shows exactly those files). One such
 *   card per edit while it is still with the client; a later pass joins it.
 *   When the last asset is passed, nothing is split — the card itself goes
 *   to the client. What was not passed stays with the editor, marked Needs
 *   changing, and goes back on Send back.
 *
 *   WITH THE CLIENT — the client on the portal, or a manager on the card
 *   when the client told them in person, approves assets one by one. Each
 *   approved asset leaves at once for a HANDOVER card, stamped accepted, in
 *   For Handoff for a manager to hand to a scheduler. When the last asset is
 *   approved, the card itself is accepted. What was not approved goes back
 *   to the editor on Send back.
 *
 * Every moved id is written on the card it left, and every reader (the
 * version tab, the portal, the share link) leaves it out from then on.
 * Best-effort: a failure here never fails the approval or the send-back — it
 * is logged and the manager can move the card by hand.
 */
type VersionFile = { id: string; name: string; url: string; mime: string | null; size: number | null; version: number }
type Stage = 'client' | 'handover'

async function versionFilesOf(item: ContentItem): Promise<VersionFile[]> {
  const pulls = await table<DrivePull>('drive_pulls').list({ by: { scope_id: item.id } as never })
  return [
    ...finalFilesOf(item).map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? null, size: f.size ?? null, version: f.version })),
    ...pulls.filter(p => p.purpose === 'finished').flatMap(p => filesOf(p))
      .filter(f => f.status === 'done' && !!f.url)
      .map(f => ({ id: f.id, name: f.name, url: f.url as string, mime: f.mime ?? null, size: f.size ?? null, version: fileRound(f) })),
  ]
}

const OPEN_AT: Record<Stage, readonly string[]> = {
  client: ['client_review', 'client_changes_requested'],
  handover: ['approved_for_scheduling'],
}

/** THE EDIT'S ROOT CARD (18 Sep 2026): a child's passes and approvals join
 *  the ROOT's children, so an edit has one to-the-client card and one
 *  handover card open at a time, however many rounds it takes. */
async function rootOf(item: ContentItem): Promise<ContentItem> {
  let cur = item
  for (let hop = 0; hop < 5; hop++) {
    const from = (cur as { split_from?: unknown }).split_from
    if (typeof from !== 'string' || !from) return cur
    const up = await table<ContentItem>('content_items').get(from)
    if (!up) return cur
    cur = up
  }
  return cur
}

/** the card's open child at that stage — made by an earlier pass or approval, not yet moved on, not closed */
async function openChildOf(item: ContentItem, stage: Stage): Promise<ContentItem | null> {
  const rows = await table<ContentItem>('content_items').list({
    where: r => (r as { split_from?: unknown }).split_from === item.id && OPEN_AT[stage].includes(String(r.status))
      && typeof (r as { merged_into?: unknown }).merged_into !== 'string'
      && (stage === 'client' || !(Array.isArray((r as { scheduler_ids?: unknown }).scheduler_ids) && ((r as { scheduler_ids?: unknown[] }).scheduler_ids as unknown[]).length > 0)),
    limit: 1,
  })
  return rows[0] ?? null
}

async function moveToStage(actor: TeamUser | null, item: ContentItem, moved: VersionFile[], remaining: number, round: number, stage: Stage): Promise<{ id: string; moved: number }> {
  const now = new Date().toISOString()
  const ids = new Set(moved.map(f => f.id))
  const approvals = clipApprovalsOf(item).filter(a => ids.has(a.file_id))
  const qc = qcApprovalsOf(item).filter(a => ids.has(a.file_id))
  const captions = captionsOf(item)
  const movedCaptions = Object.fromEntries(moved.filter(f => captions[f.id]).map(f => [f.id, captions[f.id]]))
  const files = moved.map(f => ({ id: f.id, name: f.name, url: f.url, mime: f.mime ?? 'application/octet-stream', size: f.size ?? null, version: 1, uploaded_at: now, by: actor?.id ?? null }))
  const src = item as ContentItem & Record<string, unknown>
  // ONE CARD PER EDIT PER STAGE (the owner, 18 Sep 2026: "make sure no
  // duplicates"): a child card's passes and approvals join the ROOT edit's
  // to-the-client card and handover card, never a second one
  const anchor = await rootOf(item)
  const existing = await openChildOf(anchor, stage)
  let card: ContentItem
  if (existing) {
    const have = new Set(finalFilesOf(existing).map(f => f.id))
    card = (await table<ContentItem>('content_items').update(existing.id, {
      final_files: [...finalFilesOf(existing), ...files.filter(f => !have.has(f.id))],
      clip_approvals: [...clipApprovalsOf(existing).filter(a => !ids.has(a.file_id)), ...approvals],
      qc_approvals: [...qcApprovalsOf(existing).filter(a => !ids.has(a.file_id)), ...qc],
      asset_captions: { ...captionsOf(existing), ...movedCaptions },
      updated_at: now,
    } as never)) ?? existing
  } else {
    card = await table<ContentItem>('content_items').insert({
      client_id: item.client_id,
      title: stage === 'handover' ? handoffTitle(anchor.title, round) : toClientTitle(anchor.title, round),
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
      // a to-the-client card is born at the quality check and SENT to the client
      // the normal way below, so the client and the managers are told
      status: stage === 'handover' ? 'approved_for_scheduling' : 'quality_check',
      current_version_number: 0,
      edit_round: 1,
      final_files: files,
      clip_approvals: approvals,
      qc_approvals: qc,
      asset_captions: movedCaptions,
      ...(stage === 'handover' ? { accepted_at: now, accepted_round: 1 } : {}),
      split_from: anchor.id,
      split_round: round,
      created_at: now,
      updated_at: now,
    } as never)
    if (stage === 'client' && actor) {
      try { card = (await performTransition(actor, card as never, 'client_review', { note: 'Passed the quality check, asset by asset' })) as unknown as ContentItem }
      catch (e) { console.error('[split-approved] the to-the-client card could not be sent to the client:', e) }
    }
  }

  await table<ContentItem>('content_items').update(item.id, {
    split_out: [...movedIdSet(item as never), ...moved.map(f => f.id)],
    updated_at: now,
  } as never)

  // THE COMMENTS FOLLOW THE CLIP (18 Sep 2026): what was said on a moved clip
  // — and the replies under it — is read on the card it moved to
  try {
    const said = await table<ItemComment>('item_comments').list({ by: { item_id: item.id } as never })
    const onMoved = said.filter(c => ids.has(String((c as { video_file_id?: unknown }).video_file_id ?? '')))
    const movedIds = new Set(onMoved.map(c => c.id))
    const replies = said.filter(c => !movedIds.has(c.id) && typeof c.parent_id === 'string' && movedIds.has(c.parent_id))
    await Promise.all([...onMoved, ...replies].map(c => table<ItemComment>('item_comments').update(c.id, { item_id: card.id } as never)))
  } catch (e) {
    console.error('[split-approved] the comments could not follow the clips:', e)
  }

  const where = stage === 'handover' ? 'for handover' : 'to the client'
  const words = `${moved.length} ${stage === 'handover' ? 'approved' : 'passed'} ${moved.length === 1 ? 'clip' : 'clips'} moved to “${card.title}” ${where}; ${remaining === 0 ? 'nothing stays behind' : `${remaining} ${remaining === 1 ? 'clip stays' : 'clips stay'} with the editor`}`
  await logActivity({ entityType: 'content_item', entityId: item.id, action: stage === 'handover' ? 'approved_clips_split' : 'passed_clips_split', actor, detail: words })
  await logActivity({ entityType: 'content_item', entityId: card.id, action: stage === 'handover' ? 'card_made_from_approved_clips' : 'card_made_from_passed_clips', actor, detail: existing ? `${moved.length} more from “${item.title}” at Version ${round}` : `split from “${item.title}” at Version ${round}` })
  announceItemChange({ item_id: card.id, client_id: item.client_id, status: String(card.status), kind: existing ? 'updated' : 'created' })
  announceItemChange({ item_id: item.id, client_id: item.client_id, status: String(item.status), kind: 'updated' })

  // THE MANAGERS ARE TOLD of a handover card (the owner, 17 Sep 2026); a
  // to-the-client card tells them through the normal send-to-client
  if (stage === 'handover') {
    try {
      const managers = await clientManagers(item.client_id)
      const subject = existing ? `More approved for handover: ${card.title}` : `Ready to hand over: ${card.title}`
      await Promise.all(managers.filter(m => m.id !== actor?.id).map(m => notify({
        actorName: actor?.name ?? 'The client', actorEmail: actor?.email ?? '', actorClerkId: actor?.clerk_user_id ?? null,
        eventType: 'approved_clips_split', entityType: 'content_item',
        entityId: `${card.id}#split#${m.id}#${moved.map(f => f.id).join(',').slice(0, 80)}`,
        recipientId: m.id, recipientEmail: m.email,
        subject,
        bodyHtml: renderEmail(
          subject,
          `<p>${moved.length} ${moved.length === 1 ? 'clip' : 'clips'} on <strong>${escapeHtml(item.title)}</strong> ${moved.length === 1 ? 'is' : 'are'} approved and ${existing ? 'joined' : 'now on'} <strong>${escapeHtml(card.title)}</strong> in For Handoff — hand it to a scheduler when you are ready.</p>`
          + (remaining === 0 ? '<p>Nothing stays behind — every clip is approved.</p>' : `<p>${remaining} ${remaining === 1 ? 'clip stays' : 'clips stay'} with the editor for changes.</p>`),
          'Open the handover card',
          `${DASHBOARD_URL}${itemPath(card, (m as { role?: string | null }).role)}`,
        ),
      })))
    } catch (e) {
      console.error('[split-approved] could not tell the managers:', e)
    }
  }
  return { id: card.id, moved: moved.length }
}

/** SETTLE THE CLIENT'S APPROVALS NOW (18 Sep 2026): after every approval while
 *  the card is with the client. Some approved → they move to handover; all
 *  approved → the card is accepted. Nothing approved → nothing. */
export async function settleApprovals(actor: TeamUser | null, item: ContentItem): Promise<{ moved?: number; accepted?: boolean } | null> {
  if (!OPEN_AT.client.includes(String(item.status))) return null
  const approved = approvedIdSet(clipApprovalsOf(item))
  if (approved.size === 0) return null
  const round = roundOf(item as never)
  const version = versionSet(await versionFilesOf(item), round, approved, movedIdSet(item as never))
  const { handoff, remaining } = splitApproved(version, approved)
  if (handoff.length === 0) return null
  if (remaining.length === 0) {
    if (!actor) return null
    // EVERYTHING APPROVED. ONE HANDOVER CARD PER EDIT (the owner, 18 Sep 2026:
    // "make sure no duplicates"): when the edit already has an open handover
    // card — made by the earlier approvals — the last clips join it and this
    // card closes, pointing at it. Otherwise this card is accepted whole and
    // IS the edit's handover card.
    const root = await rootOf(item)
    const existing = await openChildOf(root, 'handover')
    if (existing && existing.id !== item.id) {
      const done = await moveToStage(actor, item, handoff, 0, round, 'handover')
      try {
        await performTransition(actor, item as never, 'approved_for_scheduling', { note: `Every clip approved — all of them are on “${existing.title}”` })
        await table<ContentItem>('content_items').update(item.id, { merged_into: existing.id, updated_at: new Date().toISOString() } as never)
        announceItemChange({ item_id: item.id, client_id: item.client_id, status: 'approved_for_scheduling', kind: 'updated' })
      } catch (e) {
        console.error('[split-approved] could not close the card whose clips all moved on:', e)
      }
      return { moved: done.moved, accepted: true }
    }
    try {
      await performTransition(actor, item as never, 'approved_for_scheduling', { note: 'Every clip approved' })
      // a to-the-client card accepted whole is the edit's handover card now, and is titled as one
      if (root.id !== item.id) {
        const src = item as ContentItem & Record<string, unknown>
        await table<ContentItem>('content_items').update(item.id, { title: handoffTitle(root.title, typeof src.split_round === 'number' ? src.split_round : round), updated_at: new Date().toISOString() } as never)
      }
      return { accepted: true }
    } catch (e) {
      console.error('[split-approved] could not accept the fully approved card:', e)
      return null
    }
  }
  const done = await moveToStage(actor, item, handoff, remaining.length, round, 'handover')
  return { moved: done.moved }
}

/** SETTLE THE QUALITY CHECK NOW (18 Sep 2026): after every pass while the card
 *  is with the reviewer. Some passed → they go to the client on their own
 *  card; all passed → the card itself goes to the client. Nothing passed →
 *  nothing. */
export async function settleQualityCheck(actor: TeamUser, item: ContentItem): Promise<{ moved?: number; sent?: boolean } | null> {
  if (String(item.status) !== 'quality_check') return null
  const passed = approvedIdSet(qcApprovalsOf(item))
  if (passed.size === 0) return null
  const round = roundOf(item as never)
  const version = versionSet(await versionFilesOf(item), round, approvedIdSet(clipApprovalsOf(item)), movedIdSet(item as never))
  const { handoff: passedFiles, remaining } = splitApproved(version, passed)
  if (passedFiles.length === 0) return null
  if (remaining.length === 0) {
    // EVERYTHING PASSED — the card itself goes to the client
    try {
      await performTransition(actor, item as never, 'client_review', { note: 'Every clip passed the quality check' })
      return { sent: true }
    } catch (e) {
      console.error('[split-approved] could not send the fully passed card to the client:', e)
      return null
    }
  }
  const done = await moveToStage(actor, item, passedFiles, remaining.length, round, 'client')
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
  return moveToStage(user, item, handoff, remaining.length, round, 'handover')
}

export type { ClipApproval }
