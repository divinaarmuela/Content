/**
 * Pure audit-trail formatting — no I/O, no imports beyond the label tables.
 *
 * `workflow_activity` is written on every move (workflow.ts logActivity), but
 * the rows are database: `status_change · internal_review`. Nobody on the team
 * reads that. This turns one row into one sentence in the item's OWN
 * vocabulary — an asset is approved, a shoot brief's plan is approved, a
 * research task is simply done — so the history card says who did what,
 * never what column changed.
 */

import type { ItemStatus } from './workflow-core'

/** The overlay an item wears. The same three the detail page branches on. */
export type ActivityKind = 'asset' | 'brief' | 'task'

/** A workflow_activity row, as the API hands it over (actor already named). */
export type ActivityRow = {
  id: string
  created_at: string
  action: string
  old_value?: string | null
  new_value?: string | null
  detail?: string | null
  /** the person, already resolved — an id is not an audit trail anyone reads */
  actor_name?: string | null
}

export type ActivityLine = { id: string; at: string; text: string }

const WHO = (name?: string | null) => name?.trim() || 'someone'

/** What ARRIVING at each status is called, per overlay. */
const ARRIVED: Record<ActivityKind, Partial<Record<ItemStatus, string>>> = {
  asset: {
    internal_review: 'Submitted for review',
    revision_required: 'Changes requested',
    revision_complete: 'Revisions done',
    client_review: 'Sent to the client',
    client_changes_requested: 'Client changes logged',
    approved_for_scheduling: 'Approved',
    scheduled: 'Marked scheduled',
    published: 'Marked published',
  },
  brief: {
    internal_review: 'Brief submitted for review',
    revision_required: 'Brief changes requested',
    revision_complete: 'Brief revisions done',
    client_review: 'Plan shared with the client',
    client_changes_requested: 'Client plan changes logged',
    approved_for_scheduling: 'Plan approved',
    scheduled: 'Shoot booked',
    published: 'Shoot booked',
  },
  task: {
    internal_review: 'Submitted for review',
    revision_required: 'Changes requested',
    revision_complete: 'Revisions done',
    client_review: 'Sent to the client',
    client_changes_requested: 'Client changes logged',
    approved_for_scheduling: 'Approved — done',
    scheduled: 'Approved — done',
    published: 'Approved — done',
  },
}

/**
 * One row → one sentence, or null for a row that is not history a person
 * needs: a metadata edit, a comment (the comments card already shows it),
 * and anything from a table this item does not own.
 */
export function describeActivity(row: ActivityRow, kind: ActivityKind): string | null {
  const who = WHO(row.actor_name)
  switch (row.action) {
    case 'created':
      return `Created by ${who}`
    case 'status_change': {
      const word = ARRIVED[kind][row.new_value as ItemStatus]
      return word ? `${word} by ${who}` : null
    }
    case 'version_added': {
      // new_value is 'v3'; a task counts drafts, not versions
      const n = String(row.new_value ?? '').replace(/^v/i, '')
      if (!n) return null
      return kind === 'task' ? `Draft ${n} by ${who}` : `Version v${n} by ${who}`
    }
    case 'claimed':
      return String(row.detail ?? '').includes('scheduling')
        ? `Scheduling taken by ${who}`
        : `Taken by ${who}`
    case 'schedule_handoff':
      return `Handed to a scheduler by ${who}`
    default:
      // 'updated', 'comment_added', 'deleted' and anything new: not history,
      // or told better somewhere else on the page
      return null
  }
}

/** The whole trail, newest first, with the unreadable rows dropped. */
export function activityLines(rows: ActivityRow[], kind: ActivityKind): ActivityLine[] {
  return rows
    .map(r => {
      const text = describeActivity(r, kind)
      return text ? { id: r.id, at: r.created_at, text } : null
    })
    .filter((l): l is ActivityLine => l !== null)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

/**
 * The two facts a CARD has room for: who made it, and who signed it off.
 * Returns nulls rather than guesses — a missing row means the item predates
 * the trail, and "by someone" on a card is noise.
 */
export function cardCredits(rows: ActivityRow[]): { created_by: string | null; approved_by: string | null } {
  const created = rows.find(r => r.action === 'created')
  // the LAST approval wins: an item can go round the loop and be approved again
  const approved = [...rows]
    .filter(r => r.action === 'status_change' && r.new_value === 'approved_for_scheduling')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .pop()
  return {
    created_by: created?.actor_name?.trim() || null,
    approved_by: approved?.actor_name?.trim() || null,
  }
}
