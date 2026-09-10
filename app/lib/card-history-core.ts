/**
 * "WHAT HAPPENED" — one card's own history, in the words the team uses.
 *
 * The owner, 10 Sep 2026: "are we showing the right logs on the post approval
 * each card phases? showing the scheduler the right data and the AM or super
 * admin". The drawer showed the comment thread and nothing else, so a
 * scheduler opening a post could not see that it had been sent to the client,
 * come back with changes, been re-uploaded and then approved.
 *
 * Three sources, one list, newest first:
 *
 *   - `workflow_activity` for the moves a person made (uploaded, sent for
 *     approval, approved, changes asked, handed over, posted by hand);
 *   - the item's posting-approval fields, for a gate that was answered before
 *     the trail carried it;
 *   - `publish_jobs`, read through `outcomesForJob`, for what each CHANNEL
 *     did: booked for a time, went out with a link, or did not go out.
 *
 * Pure: no I/O, no clock, and every time is formatted by a function the
 * caller passes in, so the client's zone is the drawer's business and the
 * wording is this file's. The same list for every team role — it never
 * reaches the client, who has their own portal.
 */

import { auditActorName } from './act-as-core'
import { networkName } from './publish-core'
import { outcomesForJob, type OutcomeJob } from './post-outcome-core'
import { readPostedSlides } from './posted-slides-core'

/** A `workflow_activity` row, with its actor already named. */
export type HistoryActivity = {
  id: string
  created_at: string
  action: string
  old_value?: string | null
  new_value?: string | null
  detail?: string | null
  actor_name?: string | null
  /** the real person, when this was done by somebody acting as the actor */
  acting_by?: string | null
}

export type HistoryLine = {
  /** stable for React, and for a test to name a line */
  key: string
  /** the instant it happened, ISO */
  at: string
  /** the whole line, in plain words */
  text: string
  /** the live post, when the line is about one going out */
  href?: string | null
}

const WHO = (row: HistoryActivity) => auditActorName(row.actor_name, row.acting_by)

/** the quote in a line, kept short so one line stays one line */
const quote = (text: string | null | undefined, cap = 120) => {
  const t = String(text ?? '').trim()
  if (!t) return ''
  return `: “${t.length > cap ? `${t.slice(0, cap)}…` : t}”`
}

/**
 * One activity row in the card's words, or null for a row that is not
 * history a person needs here: a metadata edit, a comment (the thread below
 * says it better), a deletion, a link.
 */
export function describeCardActivity(row: HistoryActivity): { text: string; at?: string; href?: string | null } | null {
  const who = WHO(row)
  switch (row.action) {
    case 'created':
      return { text: `Uploaded by ${who}` }
    case 'version_added': {
      const n = String(row.new_value ?? '').replace(/^v/i, '')
      return n ? { text: `New files uploaded by ${who} · version ${n}` } : { text: `New files uploaded by ${who}` }
    }
    case 'claimed':
      return { text: String(row.detail ?? '').includes('scheduling') ? `Scheduling taken by ${who}` : `Taken by ${who}` }
    case 'schedule_handoff':
      return { text: `Handed to a scheduler by ${who}` }
    case 'sent_back':
      return { text: `Sent back for changes by ${who}${quote(row.detail)}` }
    case 'posted_by_hand': {
      const which = String(row.new_value ?? '').trim()
      const hand = handDetail(row.detail)
      return {
        text: `Posted by hand by ${who}${which ? ` · file ${which}` : ''}`,
        at: hand.at ?? undefined,
        href: hand.link,
      }
    }
    case 'posting_approval_sent':
      return { text: `Final post sent for approval by ${who}` }
    case 'posting_approved':
      return { text: `Final post approved by ${who}` }
    case 'posting_changes_requested':
      return { text: `Changes asked for on the final post by ${who}${quote(row.detail)}` }
    case 'posting_approval_reset':
      return { text: `Post changed after approval by ${who} · it needs approving again` }
    case 'status_change':
      return statusLine(row, who)
    default:
      // 'updated', 'comment_added', 'deleted', 'link_added' and anything new
      return null
  }
}

/** "posted 2026-09-10T… · https://…" — the hand record on the activity row. */
function handDetail(detail: string | null | undefined): { at: string | null; link: string | null } {
  const text = String(detail ?? '')
  const at = /posted\s+(\S+)/.exec(text)?.[1] ?? null
  const link = /(https?:\/\/\S+)/.exec(text)?.[1] ?? null
  return { at: at && !Number.isNaN(Date.parse(at)) ? at : null, link }
}

function statusLine(row: HistoryActivity, who: string): { text: string } | null {
  const to = String(row.new_value ?? '')
  const from = String(row.old_value ?? '')
  switch (to) {
    case 'internal_review':
      return { text: `Sent for approval to the team by ${who}` }
    case 'client_review':
      return { text: `Sent for approval to the client by ${who}` }
    case 'revision_required':
    case 'client_changes_requested':
      return { text: `Changes asked for by ${to === 'client_changes_requested' ? `the client, logged by ${who}` : who}` }
    case 'revision_complete':
      return { text: `Changes done by ${who}` }
    case 'approved_for_scheduling':
      return {
        text: from === 'client_review'
          ? `Approved by the client, logged by ${who}`
          : `Approved by ${who}`,
      }
    case 'scheduled':
      return { text: `Booked in by ${who}` }
    case 'published':
      return { text: `Marked posted by ${who}` }
    case 'draft_uploaded':
      return { text: `Uploaded by ${who}` }
    default:
      return null
  }
}

/* ── what each channel did ──────────────────────────────────────────────── */

/** A `publish_jobs` row for this card. */
export type HistoryJob = OutcomeJob & { id: string }

/**
 * One line per channel of one job: booked for a time, went out with its link,
 * did not go out and why, or a booking that was cancelled.
 */
export function channelLines(job: HistoryJob, fmt: (iso: string) => string): HistoryLine[] {
  const out: HistoryLine[] = []
  outcomesForJob(job).forEach((o, i) => {
    const key = `job-${job.id}-${o.platform}-${i}`
    const name = networkName(o.platform)
    const when = o.at ? fmt(o.at) : null
    const at = o.at ?? job.updated_at ?? job.created_at ?? ''
    switch (o.status) {
      case 'published':
        out.push({ key, at, text: `Went out on ${name}`, href: o.url ?? job.permalink ?? null })
        break
      case 'scheduled':
      case 'queued':
      case 'pending':
        out.push({ key, at, text: `Booked on ${name}${when ? ` for ${when}` : ''}` })
        break
      case 'failed':
        out.push({ key, at, text: `Did not go out on ${name}${o.reason ? ` · ${o.reason}` : ''}` })
        break
      case 'cancelled':
        out.push({ key, at, text: `Booking cancelled on ${name}` })
        break
    }
  })
  return out
}

/* ── the whole list ─────────────────────────────────────────────────────── */

/** How many lines the drawer shows before "Show all". */
export const HISTORY_PREVIEW = 12

/** what the section says when a card has no history yet */
export const NO_HISTORY = 'Nothing has happened to this post yet.'

/**
 * The card's history, newest first.
 *
 * `fmt` turns an instant into the client's own wall time; the drawer passes
 * `formatInZone(iso, tz, 'full')`. Rows the list cannot say anything useful
 * about are dropped rather than printed as database words.
 */
export function historyLines(input: {
  activity: readonly HistoryActivity[]
  jobs?: readonly HistoryJob[]
  /** the item's `posted_slides`, for a by-hand post with no activity row */
  postedSlides?: unknown
  fmt: (iso: string) => string
}): HistoryLine[] {
  const lines: HistoryLine[] = []
  for (const row of input.activity) {
    const said = describeCardActivity(row)
    if (!said) continue
    lines.push({
      key: `act-${row.id}`,
      at: said.at ?? row.created_at,
      text: said.text,
      href: said.href ?? null,
    })
  }
  for (const job of input.jobs ?? []) lines.push(...channelLines(job, input.fmt))

  // a file marked posted by hand on a card whose activity row is missing —
  // the record on the card is the fact, the trail is only the telling of it
  const told = new Set(lines.filter(l => l.text.startsWith('Posted by hand')).map(l => l.at))
  const posted = readPostedSlides(input.postedSlides)
  for (const h of posted?.hand ?? []) {
    if (told.has(h.at)) continue
    lines.push({ key: `hand-${h.url}`, at: h.at, text: 'Posted by hand', href: h.link ?? null })
  }

  return lines
    .filter(l => !!l.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}
