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

import { DELIVERED_ACTION, DELIVERED_LINE } from './deliver-only-core'
import { auditActorName } from './act-as-core'
import { networkName } from './publish-core'
import { outcomesForJob, type OutcomeJob } from './post-outcome-core'
import { readPostedSlides } from './posted-slides-core'
import { transferHistoryWords } from './editor-transfer-core'
import { reviewPath } from './video-review-core'

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
  /** the live post, when the line is about one going out — or the clip, when the line is about one approved */
  href?: string | null
  /** what the link is called; absent = the live post */
  hrefWord?: string | null
}

/** WHAT THE CARD HOLDS, for a line that names a clip (22 Sep 2026: "what version was approved and
 *  name of the clip — ensure there is a hyperlink"): the files, to say the version; the ticks, to find
 *  the file an older row named only by its name; the card's id, for the link to the clip. */
export type HistoryContext = {
  itemId?: string | null
  files?: readonly { id: string; name: string; version?: number | null }[]
  approvals?: readonly { file_id: string; name?: string | null; at?: string | null }[]
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
export function describeCardActivity(row: HistoryActivity, ctx: HistoryContext = {}): { text: string; at?: string; href?: string | null; hrefWord?: string | null } | null {
  const who = WHO(row)
  switch (row.action) {
    // A CLIP APPROVED, OR THE TICK TAKEN BACK (22 Sep 2026): Laura's eight ticks on The Glass Den's
    // card were in the database and not on the card
    case 'clip_approved':
    case 'clip_unapproved':
      return clipApprovalLine(row, who, ctx)
    case 'created':
      // an upload on the Schedule page says so in its detail; a card made
      // on a board with nothing in it yet was not "uploaded" (13 Sep 2026)
      return { text: String(row.detail ?? '').includes('straight from an upload') ? `Uploaded by ${who}` : `Made by ${who}` }
    case 'version_added': {
      const n = String(row.new_value ?? '').replace(/^v/i, '')
      return n ? { text: `New files uploaded by ${who} · version ${n}` } : { text: `New files uploaded by ${who}` }
    }
    case 'claimed':
      return { text: String(row.detail ?? '').includes('scheduling') ? `Scheduling taken by ${who}` : `Taken by ${who}` }
    case 'schedule_handoff':
      return { text: String(row.detail ?? '').startsWith('default') ? `Handed to the client\u2019s schedulers` : `Handed to a scheduler by ${who}` }
    case 'acknowledged':
      return { text: `Acknowledged by ${who}` }
    case DELIVERED_ACTION:
      return { text: DELIVERED_LINE }
    case 'deadline_risk':
      return { text: `Deadline risk flagged by ${who}${quote(row.detail)}` }
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
    case 'editing_transferred':
      return { text: transferHistoryWords(who, row.detail) }
    case 'status_change':
      return statusLine(row, who)
    // who a move reached, and what the mailer said (14 Sep 2026)
    case 'notified':
      return { text: String(row.detail ?? '').trim() || 'Told nobody' }
    default:
      // 'updated', 'comment_added', 'deleted', 'link_added' and anything new
      return null
  }
}

/**
 * The words of a clip's tick. A row written since 22 Sep 2026 carries the file's id in `new_value` and
 * the version in its detail; an older row named the clip only ("<name> approved by Laura (The Glass Den)
 * from <ip>"), so its file is found among the card's ticks by name and time, and the version from the
 * files. Never the address it was signed from — that is the audit's, not the card's.
 */
function clipApprovalLine(row: HistoryActivity, who: string, ctx: HistoryContext): { text: string; href?: string | null; hrefWord?: string | null } {
  const detail = String(row.detail ?? '').trim()
  const undone = row.action === 'clip_unapproved'
  const m = undone
    ? /^(.+?) — approval taken back(?: by (.+?))?(?: from .+)?$/.exec(detail)
    : /^(.+?) (?:approved by (.+?)|marked approved on the client's behalf)(?: · Version (\d+))?(?: from .+)?$/.exec(detail)
  const name = (m?.[1] ?? detail.replace(/ · Version \d+$/, '')).trim() || 'a clip'
  const by = (m?.[2] ?? '').trim() || who
  const onBehalf = /on the client's behalf|\(MD Media\)/.test(detail)
  let version = m && !undone && m[3] ? Number(m[3]) : null
  // the file: named on the row, else the tick with this name nearest this instant
  let fileId = String(row.new_value ?? '').trim() || null
  if (!fileId && ctx.approvals?.length) {
    const t = Date.parse(row.created_at)
    const near = ctx.approvals
      .filter(a => (a.name ?? '') === name)
      .map(a => ({ a, d: Math.abs(Date.parse(String(a.at ?? '')) - t) }))
      .filter(x => Number.isFinite(x.d) && x.d < 120_000)
      .sort((x, y) => x.d - y.d)[0]
    fileId = near?.a.file_id ?? null
  }
  if (version === null && ctx.files?.length) {
    const f = (fileId ? ctx.files.find(x => x.id === fileId) : null) ?? ctx.files.filter(x => x.name === name).sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0]
    version = f && Number.isFinite(Number(f.version)) ? Number(f.version) : null
  }
  const vWords = version ? ` · Version ${version}` : ''
  const text = undone
    ? `${by} took back the approval on ${name}${vWords}`
    : onBehalf
      ? `${by} marked ${name} approved on the client's behalf${vWords}`
      : `${by} approved ${name}${vWords}`
  const href = fileId && ctx.itemId ? reviewPath(ctx.itemId, fileId, name) : null
  return { text, href, hrefWord: href ? 'Open the clip' : null }
}

/** "posted 2026-09-10T… · https://…" — the hand record on the activity row. */
function handDetail(detail: string | null | undefined): { at: string | null; link: string | null } {
  const text = String(detail ?? '')
  const at = /posted\s+(\S+)/.exec(text)?.[1] ?? null
  const link = /(https?:\/\/\S+)/.exec(text)?.[1] ?? null
  return { at: at && !Number.isNaN(Date.parse(at)) ? at : null, link }
}

/** The mark the workflow puts on a status change a super admin made out of
 *  the quality check while a reviewer was flagged — they stood in for her. */
export const STAND_IN_MARK = "in the reviewer's place"
export function isStandIn(detail: string | null | undefined): boolean {
  return String(detail ?? '').includes(STAND_IN_MARK)
}

function statusLine(row: HistoryActivity, who: string): { text: string } | null {
  const to = String(row.new_value ?? '')
  const from = String(row.old_value ?? '')
  // a super admin who passed the quality check for the reviewer says so
  // (the owner, 11 Sep 2026: "yes super admin can pass quality check" —
  // allowed, and written down so the reviewer can see it)
  if (from === 'quality_check' && isStandIn(row.detail) && (to === 'client_review' || to === 'approved_for_scheduling')) {
    return { text: `Passed by ${who} ${STAND_IN_MARK}${to === 'client_review' ? ' — now with the client' : ' and approved'}` }
  }
  switch (to) {
    case 'internal_review':
      return { text: `Sent for approval to the team by ${who}` }
    case 'quality_check':
      return { text: `Sent for quality check by ${who}` }
    case 'client_review':
      // the pass is the reviewer's; the card being with the client is where it
      // went, not something they sent (the owner, 16 Sep 2026)
      return { text: from === 'quality_check' ? `Passed quality check by ${who} — now with the client` : `Sent for approval to the client by ${who}` }
    case 'revision_required':
    case 'client_changes_requested':
      return { text: `Changes asked for by ${to === 'client_changes_requested' ? `the client, logged by ${who}` : who}` }
    case 'revision_complete':
      return { text: `Changes done by ${who}` }
    case 'approved_for_scheduling':
      return {
        text: from === 'client_review'
          ? `Approved by the client, logged by ${who}`
          : from === 'quality_check'
            ? `Passed quality check and approved by ${who}`
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
export function historyLines(input: HistoryContext & {
  activity: readonly HistoryActivity[]
  jobs?: readonly HistoryJob[]
  /** the item's `posted_slides`, for a by-hand post with no activity row */
  postedSlides?: unknown
  fmt: (iso: string) => string
}): HistoryLine[] {
  const lines: HistoryLine[] = []
  for (const row of input.activity) {
    const said = describeCardActivity(row, { itemId: input.itemId, files: input.files, approvals: input.approvals })
    if (!said) continue
    lines.push({
      key: `act-${row.id}`,
      at: said.at ?? row.created_at,
      text: said.text,
      href: said.href ?? null,
      hrefWord: said.hrefWord ?? null,
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
