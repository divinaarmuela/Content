import 'server-only'
import { randomUUID } from 'node:crypto'
import { table } from '@/lib/db'
import type { ContentItem, TeamUser as TeamUserRow } from '@/lib/db-types'
import { AuthzError, type TeamUser } from './authz'
import { withRetired, finalFilesOf } from './final-files-core'
import { nextSplitRound, roundNote, roundTitle, splitPlan, type ClipNote, type SplitVideo } from './split-core'
import { logActivity, performTransition } from './workflow'
import { announceItemChange } from './production-live'
import { notify, renderEmail, escapeHtml } from './mailer'
import { DASHBOARD_URL } from './app-url'

/**
 * THE SPLIT (docs/COLOUR_GRADE_SPLIT_SPEC.md C6–C9). The videos the client approved stay on this card, which goes to
 * handover (the client's approval, or the manager logging it — auto hand-over follows as for any approval); the videos
 * they did not approve leave this version and become a new card, "<title> · Round N", for the same editor, In
 * Progress, with what the client said on each. Never check-then-write: the original card is CLAIMED first (with the
 * client, not already split), and a failure to make the new card puts it back as it was.
 */

export type SplitResult = { ok: true; approved: number; open: number; new_id: string; new_title: string }

export async function splitCard(actor: TeamUser, itemId: string, opts: { by: 'client' | 'team' }): Promise<SplitResult> {
  const items = table<ContentItem>('content_items')
  const item = await items.get(itemId)
  if (!item) throw new AuthzError('This card was not found', 404)
  const plan = splitPlan(item as never)
  if (plan.kind === 'refused') throw new AuthzError(plan.reason, 409)
  if (plan.kind !== 'split') {
    throw new AuthzError(plan.kind === 'all'
      ? 'Every video is approved — approve the card instead; nothing needs splitting'
      : 'No video is approved yet — send it back instead; nothing needs splitting', 409)
  }
  const now = new Date().toISOString()
  const newId = randomUUID()
  const n = nextSplitRound((item as { split_round?: number | null }).split_round)
  const title = roundTitle(item.title, (item as { split_round?: number | null }).split_round)

  // 1. THE CLAIM: still with the client, not already split, the same videos approved — the not-approved leave this version
  const claimed = await items.claim(item.id, cur => {
    if (!cur || cur.status !== 'client_review' || (cur as { split_at?: unknown }).split_at) return null
    const again = splitPlan(cur as never)
    if (again.kind !== 'split' || again.open.map(v => v.id).join() !== plan.open.map(v => v.id).join()) return null
    let files = finalFilesOf(cur as never)
    for (const v of again.open) files = withRetired(files, v.asset_id, again.round)
    return { ...cur, final_files: files, split_at: now, updated_at: now } as ContentItem
  })
  if (!claimed.claimed) throw new AuthzError('This card changed while you were looking — reload it and try again', 409)

  // 2. THE ROUND N CARD — a fresh card for the same editor; on failure, the original is put back
  const notes = (await table<{ id: string; item_id: string } & ClipNote>('item_comments' as never).list({ by: { item_id: item.id } as never }).catch(() => [])) as ClipNote[]
  const note = roundNote(plan.open, notes, plan.approved.length)
  const src = item as ContentItem & Record<string, unknown>
  try {
    await table('content_items').insert({
      id: newId,
      client_id: item.client_id,
      batch_id: item.batch_id ?? null,
      work_kind_id: item.work_kind_id ?? null,
      title,
      content_type: item.content_type ?? null,
      platform_targets: (item as { platform_targets?: unknown }).platform_targets ?? null,
      status: 'draft_uploaded',
      owner_id: item.owner_id ?? null,
      assigned_by: actor.id,
      due_date: null,
      priority: (item as { priority?: unknown }).priority ?? null,
      caption: null,
      client_approval_required: item.client_approval_required ?? true,
      current_version_number: 0,
      // the brief and the footage to work from carry over; the finished link does not — the editor hands in a new one
      brief: src.brief ?? null,
      raw_assets_url: src.raw_assets_url ?? null,
      raw_assets: src.raw_assets ?? null,
      link_url: src.raw_assets_url ?? null,
      link_kind: src.raw_assets_url ? (src.link_kind ?? null) : null,
      for_contact_id: src.for_contact_id ?? null,
      drive_folder_id: src.drive_folder_id ?? null,
      // what to change, where the editor reads it (the send-back's own fields)
      change_note: note,
      change_note_by: actor.id,
      change_note_at: now,
      split_from_id: item.id,
      split_round: n,
    } as never)
  } catch (e) {
    await items.claim(item.id, cur => {
      if (!cur || (cur as { split_at?: unknown }).split_at !== now) return null
      let files = finalFilesOf(cur as never)
      for (const v of plan.open) files = withRetired(files, v.asset_id, null)
      return { ...cur, final_files: files, split_at: null, updated_at: new Date().toISOString() } as ContentItem
    }).catch(() => undefined)
    throw new AuthzError(`The Round ${n} card could not be made — nothing was split. ${e instanceof Error ? e.message : ''}`.trim(), 500)
  }

  // 3. THE APPROVED VIDEOS GO TO HANDOVER — the client's approval, or the manager logging it
  const original = claimed.row as ContentItem
  await performTransition(actor, original as never, 'approved_for_scheduling', {
    note: `Split: ${plan.approved.length} approved ${plan.approved.length === 1 ? 'video goes' : 'videos go'} to handover; ${plan.open.length} ${plan.open.length === 1 ? 'goes' : 'go'} back to the editor as "${title}".`,
  })

  await logActivity({
    actor, clientId: item.client_id, entityType: 'content_item', entityId: item.id, action: 'card_split',
    detail: `${opts.by === 'client' ? 'The client sent their answers' : 'Split'}: ${names(plan.approved)} approved; ${names(plan.open)} to "${title}"`,
  }).catch(() => undefined)
  await logActivity({
    actor, clientId: item.client_id, entityType: 'content_item', entityId: newId, action: 'split_round_made',
    detail: `Round ${n} of "${item.title}": ${plan.open.length} ${plan.open.length === 1 ? 'video' : 'videos'} the client did not approve`,
  }).catch(() => undefined)
  announceItemChange({ item_id: newId, client_id: item.client_id, status: 'draft_uploaded', kind: 'created' })

  await tellTheEditor(item, newId, title, note).catch(e => console.error('split: editor notice failed', e))
  return { ok: true, approved: plan.approved.length, open: plan.open.length, new_id: newId, new_title: title }
}

const names = (vs: readonly SplitVideo[]) => vs.map(v => v.name).join(', ')

/** the editor (and, with nobody on the card, the client's account managers) — never the client (C11) */
async function tellTheEditor(item: ContentItem, newId: string, title: string, note: string): Promise<void> {
  const editor = item.owner_id ? await table<TeamUserRow>('team_users').get(item.owner_id).catch(() => null) : null
  if (!editor || !editor.active_status || !editor.email || editor.role === 'client') return
  const subject = `Upload a new Drive link: ${title}`
  await notify({
    eventType: 'split_round', entityType: 'content_item', entityId: `${newId}#split`,
    recipientId: editor.id, recipientEmail: editor.email, clientId: item.client_id,
    subject,
    bodyHtml: renderEmail(escapeHtml(subject),
      note.split('\n').map(l => `<p>${escapeHtml(l)}</p>`).join(''),
      'Open the card', `${DASHBOARD_URL}/dashboard/editor/${encodeURIComponent(newId)}`),
  })
}
