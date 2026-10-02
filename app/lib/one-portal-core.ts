/**
 * ONE PORTAL, ONE LINK — the pure rules (docs/ONE_PORTAL_SPEC.md, the owner, 2 Oct 2026: "we don't wanna keep
 * sending them different links"). No I/O, no `server-only`: the page, the engine, the routes and the sweep all ask
 * these, so a screen and the server can never disagree.
 *
 *   - The switch: `clients.portal_one`. Off = today's portal and posting order, untouched.
 *   - The posting order with it on: Draft → quality check → BOOKED → the client answers on the Scheduling tab.
 *   - Not approved takes the post off; "Wait for the client" posts come off 15 minutes before an unanswered time;
 *     any answer inside the last 15 minutes moves the post to the next free 15-minute slot first (R8).
 */

import { MIN_LEAD_MS } from './social-schedule-core'
import type { PortalScope } from './portal-owner-core'

/* ── the switch ─────────────────────────────────────────────────────────── */

/** Is this client on the one portal (and the booked-first posting order)? Only an explicit true counts. */
export function onePortal(client: { portal_one?: unknown } | null | undefined): boolean {
  return client?.portal_one === true
}

/* ── the client's word on a booked post ─────────────────────────────────── */

export type IfNoAnswer = 'post' | 'wait'
export const IF_NO_ANSWER_WORDS: Record<IfNoAnswer, string> = {
  post: 'Post anyway',
  wait: 'Wait for the client',
}
/** The team's choice for a post the client has not approved; unset is "post anyway" (the owner's default). */
export function ifNoAnswerOf(row: { if_no_answer?: unknown } | null | undefined): IfNoAnswer {
  return row?.if_no_answer === 'wait' ? 'wait' : 'post'
}

export type ClientVerdict = 'approved' | 'not_approved'
export type ClientReview = { version: number; verdict: ClientVerdict; note: string | null; by: string; at: string }
export type ReviewAsked = { version: number; at: string; by: string | null }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function readClientReview(v: unknown): ClientReview | null {
  if (!isObj(v)) return null
  const version = Number(v.version)
  const verdict = v.verdict === 'approved' || v.verdict === 'not_approved' ? v.verdict : null
  if (!Number.isInteger(version) || version < 1 || !verdict || typeof v.at !== 'string') return null
  return { version, verdict, note: typeof v.note === 'string' && v.note.trim() ? v.note : null, by: String(v.by ?? ''), at: v.at }
}

export function readReviewAsked(v: unknown): ReviewAsked | null {
  if (!isObj(v)) return null
  const version = Number(v.version)
  if (!Number.isInteger(version) || version < 1 || typeof v.at !== 'string') return null
  return { version, at: v.at, by: typeof v.by === 'string' ? v.by : null }
}

/**
 * Where the client's word stands on a post, as the tile and the team's chip say it:
 *   approved       — they approved (any version: a change after approval KEEPS it, R9)…
 *   asked_again    — …unless the team sent it to them again after that, for a newer version
 *   not_approved   — they said no (the post is off the schedule)
 *   not_reviewed   — booked, no word yet
 */
export type ReviewState = 'approved' | 'asked_again' | 'not_approved' | 'not_reviewed'
export function reviewState(post: { client_review?: unknown; review_asked?: unknown; sent_version?: unknown }): ReviewState {
  const r = readClientReview(post.client_review)
  const asked = readReviewAsked(post.review_asked)
  if (!r) return 'not_reviewed'
  // a no is about the version it was given on: once the team re-books a NEWER version, that one is unanswered
  // (2 Oct 2026, the walk: a fixed, re-booked post still read "Not approved — off the schedule")
  const sent = Number(post.sent_version)
  if (r.verdict === 'not_approved') return Number.isInteger(sent) && sent > r.version ? 'not_reviewed' : 'not_approved'
  if (asked && asked.version > r.version && asked.at > r.at) return 'asked_again'
  return 'approved'
}

export const REVIEW_WORDS: Record<ReviewState, string> = {
  approved: 'Approved',
  asked_again: 'Updated — have another look',
  not_approved: 'Not approved — off the schedule',
  not_reviewed: 'Not reviewed yet',
}

/** The team side: was the post changed after the client approved it? (R9: the approval stands, the team is shown.) */
export function changedSinceApproval(post: { client_review?: unknown; sent_version?: unknown }): boolean {
  const r = readClientReview(post.client_review)
  const sent = Number(post.sent_version)
  return !!r && r.verdict === 'approved' && Number.isInteger(sent) && sent > r.version
}

/* ── the 15-minute slot (R8) ────────────────────────────────────────────── */

export const SLOT_MS = 15 * 60 * 1000

/** Inside the last 15 minutes before its time (or past it)? Then an answer moves it first. */
export function insideLastSlot(scheduledFor: string | null | undefined, nowMs: number): boolean {
  const t = Date.parse(String(scheduledFor ?? ''))
  return Number.isFinite(t) && t - nowMs < MIN_LEAD_MS
}

/**
 * THE NEXT FREE 15-MINUTE SLOT: the first quarter hour at least MIN_LEAD_MS from now that no other post on the
 * same channels already holds. `taken` are the other posts' times (ms) on any of this post's channels.
 */
export function nextFreeSlot(nowMs: number, taken: readonly number[] = []): number {
  const busy = new Set(taken.map(t => Math.floor(t / SLOT_MS)))
  let slot = Math.ceil((nowMs + MIN_LEAD_MS) / SLOT_MS)
  for (let i = 0; i < 96 && busy.has(slot); i++) slot += 1
  return slot * SLOT_MS
}

/* ── the client's answer: may it be given? ──────────────────────────────── */

export const ANSWER_STALE = 'This post was just updated — have a look again.'
export const ANSWER_LIVE = 'This has already been posted — your account manager has been told.'
export const ANSWER_NOTE_NEEDED = 'Say what should change, so the team can fix it.'
export const ANSWER_NOT_OPEN = 'This post is not waiting on you.'

/**
 * May the client give this answer now? null = yes. A booked post is answerable; so is a "wait" post that came off
 * unanswered (ready, its client_review empty) — approving it books the next slot. `version` is the frozen
 * version the client looked at.
 */
export function clientAnswerProblem(
  post: { stage: string; sent_version: number | null; if_no_answer?: unknown; client_review?: unknown },
  input: { version: number; verdict: ClientVerdict; note?: string | null },
  liveOn: readonly string[],
): string | null {
  // unanswered FOR THIS VERSION: an old no on an earlier version does not close it (2 Oct 2026, the live hold test)
  const state = reviewState(post)
  const heldWaiting = post.stage === 'ready' && ifNoAnswerOf(post) === 'wait' && (state === 'not_reviewed' || state === 'asked_again')
  if (post.stage === 'posted' || liveOn.length > 0) return ANSWER_LIVE
  if (post.stage !== 'booked' && !heldWaiting) return ANSWER_NOT_OPEN
  if (post.sent_version == null || input.version !== post.sent_version) return ANSWER_STALE
  if (input.verdict === 'not_approved' && !String(input.note ?? '').trim()) return ANSWER_NOTE_NEEDED
  return null
}

/* ── the sweep: reminders and holds ─────────────────────────────────────── */

export const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000

/**
 * The client reminder (R6, decided 2 Oct 2026): 24 h before the time, or at once when the post was asked later
 * than that. Only for a booked post the client was asked about and has not answered for that version; once per
 * version (the caller dedupes on `<post>#v<version>`).
 */
export function reminderDue(
  post: { stage: string; scheduled_for: string | null; client_review?: unknown; review_asked?: unknown },
  nowMs: number,
): boolean {
  if (post.stage !== 'booked') return false
  const asked = readReviewAsked(post.review_asked)
  if (!asked) return false
  const r = readClientReview(post.client_review)
  if (r && r.version >= asked.version) return false
  const t = Date.parse(String(post.scheduled_for ?? ''))
  if (!Number.isFinite(t) || t <= nowMs) return false
  return nowMs >= t - REMINDER_LEAD_MS
}

/** A "wait" post with no approval, 15 minutes from its time: it comes off the schedule (R7). */
export function holdDue(
  post: { stage: string; scheduled_for: string | null; if_no_answer?: unknown; client_review?: unknown },
  nowMs: number,
): boolean {
  if (post.stage !== 'booked' || ifNoAnswerOf(post) !== 'wait') return false
  const r = readClientReview(post.client_review)
  if (r?.verdict === 'approved') return false
  const t = Date.parse(String(post.scheduled_for ?? ''))
  return Number.isFinite(t) && t - nowMs <= MIN_LEAD_MS
}

/* ── who sees what ──────────────────────────────────────────────────────── */

/**
 * A post on this portal: the business link sees every post not made from a person's piece; a person's link sees
 * only the posts made from their own pieces (decided 2 Oct 2026). `itemContact` is the source card's
 * for_contact_id (undefined when the post has no card).
 */
export function postOnPortal(itemContact: string | null | undefined, scope: PortalScope): boolean {
  const who = itemContact ?? null
  return scope.kind === 'business' ? who === null : who === scope.contactId
}

export type PortalTab = 'shoot' | 'editing' | 'designing' | 'scheduling' | 'boards'
export const PORTAL_TABS: readonly { key: PortalTab; label: string }[] = [
  { key: 'shoot', label: 'Shoot brief' },
  { key: 'editing', label: 'Editing' },
  { key: 'designing', label: 'Designing' },
  { key: 'scheduling', label: 'Scheduling' },
  // the boards the team shares with the client — their own tab (the owner, 2 Oct 2026: "yes 5th tab")
  { key: 'boards', label: 'Boards' },
]
export function readTab(v: unknown): PortalTab {
  return PORTAL_TABS.some(t => t.key === v) ? (v as PortalTab) : 'scheduling'
}

/** Which tab a piece of work belongs in: graphics are Designing, every other edit is Editing. */
export function workTab(workKindSlug: string | null | undefined): 'editing' | 'designing' {
  return workKindSlug === 'graphics' ? 'designing' : 'editing'
}

/** The one link, opening a tab (and one thing in it). Every email after launch is built here. */
export function onePortalPath(token: string, tab?: PortalTab, id?: string | null): string {
  const q = new URLSearchParams()
  if (tab) q.set('tab', tab)
  if (id) q.set('id', id)
  const qs = q.toString()
  return `/portal/${encodeURIComponent(token)}/home${qs ? `?${qs}` : ''}`
}

/**
 * THE OLD LINKS (launch, docs/ONE_PORTAL_SPEC.md): every address a client of the one portal was ever sent — the
 * old portal, a shoot, its board, a team board, an edit, a piece, an approval, a post, the posts list — opens the
 * same thing inside the one link. A piece's tab comes from its work kind (graphics → Designing).
 */
export type OldPortalLink =
  | { kind: 'root' | 'posts' }
  | { kind: 'shoot' | 'board' | 'team-board' | 'post' | 'item' | 'edit' | 'approve'; id: string }

export function oldLinkTarget(token: string, link: OldPortalLink, workKindSlug?: string | null): string {
  switch (link.kind) {
    case 'root': return onePortalPath(token)
    case 'posts': return onePortalPath(token, 'scheduling')
    case 'shoot':
    case 'board': return onePortalPath(token, 'shoot', link.id)
    case 'team-board': return onePortalPath(token, 'boards', link.id)
    case 'post': return `${onePortalPath(token, 'scheduling')}&post=${encodeURIComponent(link.id)}`
    case 'item':
    case 'edit':
    case 'approve': return onePortalPath(token, workTab(workKindSlug), link.id)
  }
}
