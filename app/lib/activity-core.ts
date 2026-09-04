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

import { TRANSITIONS, type ItemStatus } from './workflow-core'

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
    internal_review: 'Plan sent for review',
    revision_required: 'Plan changes requested',
    revision_complete: 'Plan changes done',
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
      // the client's own yes is a different sentence from the team's, and the
      // button that writes it says so — the history has to match it
      if (row.new_value === 'approved_for_scheduling' && row.old_value === 'client_review') {
        return kind === 'task' ? `Client approved — marked done by ${who}`
          : kind === 'brief' ? `The client's plan approval logged by ${who}`
          : `The client's approval logged by ${who}`
      }
      // An `auto` edge is the APP's own move and its label IS the reason —
      // "Sent to the client by Ana" is indistinguishable from a manager
      // pressing the button, and leaves nobody able to see WHY a piece the
      // client had already approved is back in front of them. The detail
      // carries the rule's words; every other line keeps the arrival words,
      // because there `detail` is only the name of the button that was
      // pressed and would say the same thing twice.
      const rule = TRANSITIONS[row.old_value as ItemStatus]?.[row.new_value as ItemStatus]
      if (rule?.auto) {
        const why = String(row.detail ?? '').trim() || rule.label
        return `${why} — ${who}`
      }
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
    // ── the final-post gate: who asked, who answered, and why an answer
    //    was ever taken back ──
    case 'posting_approval_sent':
      return `Post sent for final approval by ${who}`
    case 'posting_approved':
      return `Final post approved by ${who}`
    case 'posting_changes_requested':
      return row.detail
        ? `Post changes asked for by ${who} — “${String(row.detail).slice(0, 120)}”`
        : `Post changes asked for by ${who}`
    case 'posting_approval_reset':
      return `Post edited after approval by ${who} — needs approving again`
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
