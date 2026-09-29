/**
 * THE POST APPROVAL BOARD — the pure half (the posting rebuild, 29 Sep 2026).
 *
 * Read docs/posting-rebuild/OWNER_DECISIONS.md first, then SPEC.md §4.2.
 *
 * What the old board got wrong, and what this file does instead:
 *
 *   - A card was drawn in one column (the post's approval) and acted on as
 *     another (the edit's status), so a drag said "Already in Ready to post"
 *     on a card sitting in Draft (audit B1). Here the lane is `laneOf(post)`,
 *     which is `post.stage`, and every button, every Move entry and every drop
 *     comes from `postActions` — the same list the server checks against.
 *   - "Sent to client" was printed for posts nobody sent (B4, B16). Here the
 *     line is read only from `client_send` of the version now with the client.
 *   - "The client asked for a change" was printed when a manager asked (B6).
 *     Here it comes from `changes_asked.who`.
 *   - The "since" reset every time the card was touched (B14). Here it is
 *     `stage_at`, when the post entered its stage.
 *
 * The board is Post approval's (the owner's decision 1): Draft, Quality check,
 * With client, and Approved. Booking is the Schedule page's job, so this page
 * never offers Book in, Post now or Change time — an approved card says where
 * to go instead.
 *
 * No I/O, no React, no clock: `now` is passed in.
 */

import {
  APPROVAL_STEPS_LABEL, MISSED_LABEL, POST_APPROVAL_LANES, POST_TRANSITIONS, ROW_OF, STAGE_LABEL, approveByOf,
  STAGE_WORDS, approvalLine, approvalStepsOf, changesAskedLine, checkPostTransition, clientSendLine,
  STAGE_PAGE, laneOf, mayWorkOnPost, pageLaneOf, postActions, postTone, postedWords, slotMissed, waitingOn,
  type Lane, type NowLike, type OfferedAction, type PostAction, type PostActionList, type PostHat,
  type PostStage, type PostState, type StageTone, type TransitionContext, type Waiting,
} from './post-stage-core'
import { deliverOnly } from './deliver-only-core'
import { networkName } from './publish-core'
import { dayKeyInZone, DEFAULT_TZ, formatInZone } from './timezone-core'
import { sinceWords } from './waiting-core'

/* ── which posts this page shows ────────────────────────────────────────── */

/** A person looking at the board, as `useRole` gives them. */
export type BoardPerson = { id: string; role: string; quality_reviewer?: boolean | null }

/** One `team_user_clients` row: who looks after which client. */
export type ClientAssignment = { team_user_id: string; client_id: string }

/** How long a posted post stays in the Approved lane, in days. Older ones are records on Schedule. */
export const POSTED_DAYS_ON_BOARD = 14

/**
 * MAY THIS PERSON SEE THIS POST ON THE BOARD?
 *
 *   super admin, scheduler, general — every client (schedulers build and book
 *   for anyone; the old item scope gated them by status, which a post does not
 *   have).
 *   quality checker — every post waiting on the quality check, whoever's
 *   client it is (the reviewer's desk), plus their own clients.
 *   account manager, anyone else — the clients they look after.
 * The act route asks the very same question (`mayWorkOnPost`).
 */
export function postVisibleTo(
  post: Pick<PostState, 'client_id' | 'stage' | 'created_by' | 'assigned_to' | 'changes_asked'>,
  person: BoardPerson,
  assignments: readonly ClientAssignment[],
): boolean {
  // the SAME rule the act route checks (`mayWorkOnPost`), so a card never
  // offers a press the server refuses with "That client is not one of yours"
  const clientIds = ['super_admin', 'scheduler', 'general'].includes(person.role)
    ? null
    : assignments.filter(a => a.team_user_id === person.id).map(a => a.client_id)
  return mayWorkOnPost(person, post, clientIds)
}

const ms = (t: NowLike | null | undefined): number => {
  if (t == null) return NaN
  return t instanceof Date ? t.getTime() : typeof t === 'number' ? t : new Date(t).getTime()
}

/**
 * THE POSTS THE LANES HOLD: not cancelled (they sit in their own folded list),
 * and a posted one only while it is recent — the board is what is happening
 * now, the Schedule page keeps the rest.
 */
export function onBoard(post: Pick<PostState, 'stage' | 'stage_at'>, now: NowLike, days = POSTED_DAYS_ON_BOARD): boolean {
  if (post.stage === 'cancelled') return false
  if (pageLaneOf(POST_APPROVAL_LANES, post.stage) === null) return false
  if (post.stage !== 'posted') return true
  const at = ms(post.stage_at)
  if (!Number.isFinite(at)) return true // nothing hidden on a guess
  return at >= ms(now) - days * 24 * 60 * 60_000
}

const STAGE_ORDER: Record<PostStage, number> = {
  draft: 0, quality_check: 1, with_client: 2, ready: 3, booked: 4, posted: 5, cancelled: 6,
}

/**
 * The lanes, every one present (empty ones too), each holding the posts whose
 * STAGE it holds — never a rewrite of the stage (audit B1, B11). Oldest wait
 * first in the approval lanes; in Approved, by stage, the newest first.
 */
export function groupPosts<T extends Pick<PostState, 'id' | 'stage' | 'stage_at'>>(
  posts: readonly T[], lanes: readonly Lane[] = POST_APPROVAL_LANES,
): { lane: Lane; posts: T[] }[] {
  const buckets = new Map<string, T[]>(lanes.map(l => [l.key, []]))
  for (const p of posts) {
    const key = pageLaneOf(lanes, laneOf(p))
    if (key) buckets.get(key)!.push(p)
  }
  return lanes.map(lane => {
    const inLane = [...buckets.get(lane.key)!]
    const multi = lane.stages.length > 1
    inLane.sort((a, b) => {
      if (multi && a.stage !== b.stage) return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
      const at = String(a.stage_at ?? ''), bt = String(b.stage_at ?? '')
      if (at !== bt) return multi ? (at < bt ? 1 : -1) : (at < bt ? -1 : 1)
      return a.id.localeCompare(b.id)
    })
    return { lane, posts: inLane }
  })
}

/** The lane a `?lane=` (or the old `?column=`) link opens on — null when it names nothing here. */
export function laneFromAddress(value: string | null | undefined): string | null {
  const v = String(value ?? '')
  if (POST_APPROVAL_LANES.some(l => l.key === v)) return v
  // the old board's column keys, still in emails and on the Overview
  const OLD: Record<string, string> = {
    draft: 'draft', quality_check: 'quality_check', with_client: 'with_client',
    ready_to_post: 'approved', booked: 'approved', posted: 'approved',
  }
  return OLD[v] ?? null
}

/* ── what the page offers ───────────────────────────────────────────────── */

/**
 * THE MOVES THIS PAGE OFFERS (the owner's decision 1: "no booking on Post
 * approval"). Every other move in `postActions` belongs to the Schedule page
 * or to the post window (Save). Keyed by the stage it is offered from, so a
 * cancel on a booked post — which takes a job off the provider — stays with
 * Schedule.
 */
export const PAGE_ACTIONS: Readonly<Partial<Record<PostStage, readonly PostAction[]>>> = {
  draft: ['send_to_qc', 'set_steps', 'delete_draft', 'cancel'],
  quality_check: ['pass', 'pass_send_client', 'ask_change', 'edit', 'set_steps', 'cancel'],
  with_client: ['resend_new_time', 'approve_for_client', 'team_decides', 'take_back', 'cancel'],
  ready: ['send_to_client', 'edit', 'set_steps', 'cancel'],
  cancelled: ['rebook', 'duplicate'],
}

/** May this page offer this move on a post in this stage? */
export function pageOffers(stage: PostStage, action: PostAction): boolean {
  return (PAGE_ACTIONS[stage] ?? []).includes(action)
}

/**
 * THE BUTTONS ON A CARD, THE MOVE MENU, THE DROPS AND WAITING ON YOU — one
 * list, from `postActions`, narrowed to this page's moves. The main button
 * stays the one `postActions` chose, or none: a move it did not choose (Send
 * to client on a Ready post) is never promoted to the filled button.
 */
export function boardActions(
  post: PostState,
  hats: readonly PostHat[],
  now: NowLike,
  ctx: Omit<TransitionContext, 'now'> = {},
): PostActionList {
  const all = postActions(post, hats, now, ctx)
  const keep = (a: OfferedAction | null): a is OfferedAction => !!a && pageOffers(post.stage, a.action)
  return {
    primary: keep(all.primary) ? all.primary : null,
    secondary: all.secondary.filter(keep),
    danger: keep(all.danger) ? all.danger : null,
  }
}

/** Every offered move, in the order the card lists them. */
export function offeredList(list: PostActionList): OfferedAction[] {
  return [list.primary, ...list.secondary, list.danger].filter((a): a is OfferedAction => !!a)
}

/**
 * WHERE AN APPROVED POST IS BOOKED: the Schedule page (the owner's decision 1).
 * A Ready card's way forward on this page is this link, never a Book button.
 */
export function scheduleLink(post: Pick<PostState, 'id' | 'client_id' | 'stage'>, schedulePage: string): { label: string; href: string } | null {
  const words: Partial<Record<PostStage, string>> = {
    ready: 'Book it on Schedule',
    booked: 'See it on Schedule',
    posted: 'See it on Schedule',
  }
  const label = words[post.stage]
  if (!label) return null
  return { label, href: postWindowHref(post, schedulePage) }
}

/** Post approval's own address. */
export const POST_APPROVAL_PAGE = '/dashboard/scheduler'

/**
 * THE POST WINDOW'S ADDRESS for one post — on the page that owns the post's
 * stage (the owner's decision 1). Draft, Quality check and With client open it
 * on Post approval, so nobody approves on Schedule and the quality checker
 * (who has no Schedule page) can always open what they are asked to pass.
 * Ready to post, Booked in and Posted open it on Schedule. A cancelled post
 * belongs to both, and opens where the person already is (`here`).
 * The window is the same one wherever it opens (decision 2).
 */
export function postWindowHref(
  post: Pick<PostState, 'id' | 'client_id'> & { stage?: PostStage | null },
  schedulePage: string,
  here: 'post_approval' | 'schedule' = 'post_approval',
): string {
  const owner = post.stage ? STAGE_PAGE[post.stage] : 'schedule'
  const page = owner === 'both' ? here : owner
  return page === 'post_approval'
    ? `${POST_APPROVAL_PAGE}?post=${encodeURIComponent(post.id)}`
    : `${schedulePage}?client=${encodeURIComponent(post.client_id)}&post=${encodeURIComponent(post.id)}`
}

/** "Make a post" from an edit that is ready to become one — the Schedule page opens its composer on the piece. */
export function makePostHref(item: { id: string; client_id: string }, schedulePage: string): string {
  return `${schedulePage}?client=${encodeURIComponent(item.client_id)}&item=${encodeURIComponent(item.id)}`
}

/* ── a round: several posts to one client, in one email ─────────────── */

/** The moves a round makes: a pass at the quality check, or a send once passed (decision 15). */
export const ROUND_ACTIONS: readonly PostAction[] = ['pass_send_client', 'send_to_client']

/**
 * THE POSTS THAT CAN GO TO THEIR CLIENT RIGHT NOW, by client — each with the
 * move it would make, read from the same button list the card draws
 * (`boardActions`). A post whose send is stopped by a rule is left out, so the
 * round never offers what the server would refuse.
 */
export function roundCandidates<B extends { post: PostState; hats: readonly PostHat[]; ctx: Omit<TransitionContext, 'now'>; face: { client: string } }>(
  posts: readonly B[], now: NowLike,
): { clientId: string; clientName: string; posts: { bp: B; label: string }[] }[] {
  const byClient = new Map<string, { clientId: string; clientName: string; posts: { bp: B; label: string }[] }>()
  for (const bp of posts) {
    const move = offeredList(boardActions(bp.post, bp.hats, now, bp.ctx))
      .find(a => ROUND_ACTIONS.includes(a.action) && !a.blocked)
    if (!move) continue
    const g = byClient.get(bp.post.client_id) ?? { clientId: bp.post.client_id, clientName: bp.face.client, posts: [] }
    g.posts.push({ bp, label: move.label })
    byClient.set(bp.post.client_id, g)
  }
  return [...byClient.values()].sort((a, b) => a.clientName.localeCompare(b.clientName))
}

/* ── a drop onto a lane ─────────────────────────────────────────────────── */

export type PostDrop = { ok: true; action: OfferedAction } | { ok: false; reason: string }

/** Where a move lands, as a board lane key, or null (cancelled, deleted, a lane this page does not draw). */
function landingLane(post: PostState, action: PostAction, lanes: readonly Lane[]): string | null {
  const to = ROW_OF[action].to
  if (to === 'deleted') return null
  return pageLaneOf(lanes, to === 'same' ? post.stage : to)
}

export const FIRST_THE_CHECK = 'Send it for quality check first — every post passes the quality check before it goes to the client or is approved.'

/**
 * WHAT A DROP ONTO A LANE DOES: the move from the card's own list that lands
 * there, or a refusal with the rule's own reason (SPEC §4.2; audit B1, J9).
 * A move that needs words (a note, how the client agreed, who to email) is
 * returned like a button press, so the board asks for them the same way.
 */
export function dropOnPostLane(
  post: PostState,
  laneKey: string,
  hats: readonly PostHat[],
  now: NowLike,
  ctx: Omit<TransitionContext, 'now'> = {},
  lanes: readonly Lane[] = POST_APPROVAL_LANES,
): PostDrop {
  const target = lanes.find(l => l.key === laneKey)
  if (!target) return { ok: false, reason: 'That is not a column on this board.' }
  const here = pageLaneOf(lanes, laneOf(post))
  if (here === laneKey) return { ok: false, reason: `Already in ${target.label}` }

  const candidates = offeredList(boardActions(post, hats, now, ctx))
    .filter(a => landingLane(post, a.action, lanes) === laneKey)
  const open = candidates.find(a => !a.blocked)
  if (open) return { ok: true, action: open }
  if (candidates[0]?.blocked) return { ok: false, reason: candidates[0].blocked }

  // not offered: say the rule's own reason, from the same check the server runs
  if (post.stage === 'draft' && (target.stages.includes('with_client') || target.stages.includes('ready'))) {
    return { ok: false, reason: FIRST_THE_CHECK }
  }
  // the team's own rows first: a scheduler dragging a post the client has onto
  // Approved is told who may approve it for the client, not that the client may
  const team = (r: (typeof POST_TRANSITIONS)[number]) => r.who.some(h => h !== 'client' && h !== 'system')
  const rows = POST_TRANSITIONS.filter(r =>
    r.from.includes(post.stage) && !r.who.includes('system')
    && pageLaneOf(lanes, r.to === 'same' || r.to === 'deleted' ? post.stage : r.to) === laneKey)
    .sort((a, b) => Number(team(b)) - Number(team(a)))
  for (const row of rows) {
    const r = checkPostTransition(post, row.action, { id: null, hats }, {
      expect_rev: post.rev, version: post.sent_version, note: 'x', agreed_via: 'call',
      assign_to: post.created_by ?? 'someone', confirm: true, steps: 'team',
    }, { ...ctx, now }, { lenient: true })
    if (!r.ok) return { ok: false, reason: r.reason }
    if (!pageOffers(post.stage, row.action)) {
      return { ok: false, reason: `"${row.label}" is done on the Schedule page, not here.` }
    }
  }
  return { ok: false, reason: `A post in ${STAGE_LABEL[post.stage]} cannot be moved to ${target.label}. Open it to see what it can do.` }
}

/** The Move menu: every lane a drop could reach right now, worded "Move to Quality check — Send for quality check". */
export function postMoveTargets(
  post: PostState,
  hats: readonly PostHat[],
  now: NowLike,
  ctx: Omit<TransitionContext, 'now'> = {},
  lanes: readonly Lane[] = POST_APPROVAL_LANES,
): { lane: string; label: string; action: OfferedAction }[] {
  const out: { lane: string; label: string; action: OfferedAction }[] = []
  for (const lane of lanes) {
    const d = dropOnPostLane(post, lane.key, hats, now, ctx, lanes)
    if (d.ok) out.push({ lane: lane.key, label: `Move to ${lane.label} — ${d.action.label}`, action: d.action })
  }
  return out
}

/* ── the face of a card ─────────────────────────────────────────────────── */

type NameOf = (id: string | null | undefined) => string | null | undefined

/** The words a card says about its post — every one a fact read off the post. */
export type PostCardFace = {
  id: string
  title: string
  client: string
  clientId: string
  /** the stage chip: always drawn, so a card in Approved says which stage it is at */
  stage: { label: string; tone: StageTone }
  /** the card's tint: its stage's, or red when its time was missed or it came back with a problem */
  tone: StageTone
  /** every network it goes to, once each, for its logo and its name (audit S14) */
  networks: { platform: string; label: string }[]
  /** who has it now, and since when (audit B8, B11, B14) */
  waiting: Waiting & { sinceWords: string | null }
  /** "Missed — needs a new time" when the time went while it waited */
  missed: string | null
  /** "Joy asked for a change: …" / "The client asked for a change: …" (audit B6) */
  changes: string | null
  /** "Emailed to jordan@acme.com · 28 Sep" — only from a send of THIS version (audit B4, B16) */
  sent: string | null
  /** "Answer needed by Tue 29 Sep, 3:00 pm" — while the client has it and the time is open (decision 11) */
  answerBy: string | null
  /** "Approved by Akmal for the client — on WhatsApp" — only for this version (decision 5, audit P6) */
  approval: string | null
  /** when it goes out, in the post's own zone */
  when: string | null
  /** "Version 2" — the frozen version with the reviewer or the client */
  version: string | null
  /** "Team only" / "Team, then the client" — shown while it is being approved */
  steps: string | null
  /** a sentence about something wrong: what came back from booked, a lost card */
  problem: string | null
  /** the pictures, first three, for the face */
  thumbs: { url: string; type: 'image' | 'video' }[]
  /** "Posted on 1 of 2 — LinkedIn did not go out", for a posted card */
  posted: string | null
}

/** What a post is called on a card: the edit it came from, or its caption's first line. */
export function postTitle(post: Pick<PostState, 'caption'>, sourceTitle?: string | null): string {
  const title = String(sourceTitle ?? '').trim()
  if (title) return title
  const line = String(post.caption ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? ''
  if (!line) return 'Untitled post'
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

/** A channel the page could not find among the client's connected accounts. */
export const UNKNOWN_NETWORK = { platform: 'unknown', label: 'A channel that is not connected' } as const

/** The networks this post goes to, from its channels, once each, in the order they were chosen. */
export function postNetworks(
  post: Pick<PostState, 'channels'>,
  platformOf: (accountId: string) => string | null | undefined,
): { platform: string; label: string }[] {
  const out: { platform: string; label: string }[] = []
  for (const id of post.channels) {
    const raw = platformOf(id)
    const n = raw ? { platform: String(raw).toLowerCase(), label: networkName(raw) } : { ...UNKNOWN_NETWORK }
    if (!out.some(o => o.platform === n.platform)) out.push(n)
  }
  return out
}

export function postCardFace(
  post: PostState,
  opts: {
    now: NowLike
    /** 'YYYY-MM-DD' in the viewer's zone — for "since Tuesday" */
    today: string
    clientName?: string | null
    client?: { client_approval_required?: boolean | null } | null
    sourceTitle?: string | null
    nameOf?: NameOf
    platformOf?: (accountId: string) => string | null | undefined
    zone?: string | null
  },
): PostCardFace {
  const nameOf = opts.nameOf ?? (() => null)
  const zone = post.timezone || opts.zone || DEFAULT_TZ
  const wait = waitingOn(post, opts.now, nameOf)
  const sinceDay = wait.since ? dayKeyInZone(wait.since, zone) : null
  const current = post.sent_version
  // a send or an approval of an EARLIER version is history, not a fact about this card
  const send = post.client_send && post.client_send.version === current ? post.client_send : null
  const sentLine = clientSendLine(send)
  const sentDay = send?.at ? formatInZone(send.at, zone, 'date') : null
  const approval = post.approval && post.approval.version === current ? post.approval : null
  const ca = post.changes_asked
  const asked = changesAskedLine(ca, nameOf)
  const approving = ['draft', 'quality_check', 'with_client'].includes(post.stage)
  return {
    id: post.id,
    title: postTitle(post, opts.sourceTitle),
    client: String(opts.clientName ?? '').trim() || 'This client',
    clientId: post.client_id,
    stage: { label: STAGE_WORDS[post.stage].label, tone: STAGE_WORDS[post.stage].tone },
    tone: postTone(post, opts.now),
    networks: opts.platformOf ? postNetworks(post, opts.platformOf) : [],
    waiting: { ...wait, sinceWords: sinceDay ? sinceWords(sinceDay, opts.today) : null },
    missed: slotMissed(post, opts.now) ? MISSED_LABEL : null,
    changes: asked && post.stage === 'draft' ? (ca?.note.trim() ? `${asked}: ${ca.note.trim()}` : asked) : null,
    sent: sentLine && post.stage === 'with_client' ? (sentDay ? `${sentLine} · ${sentDay}` : sentLine) : null,
    answerBy: post.stage === 'with_client' && send && !slotMissed(post, opts.now) && approveByOf(post)
      ? `Answer needed by ${formatInZone(approveByOf(post)!, zone, 'full')}` : null,
    approval: ['ready', 'booked', 'posted'].includes(post.stage) ? approvalLine(approval, nameOf) : null,
    when: post.scheduled_for ? formatInZone(post.scheduled_for, zone, 'full') : null,
    version: current != null && post.stage !== 'draft' ? `Version ${current}` : null,
    steps: approving ? APPROVAL_STEPS_LABEL[approvalStepsOf(post, opts.client)] : null,
    problem: post.source_deleted
      ? [post.problem, 'The card it came from was deleted.'].filter(Boolean).join(' ')
      : post.problem,
    thumbs: post.slides.slice(0, 3).map(s => ({ url: s.url, type: s.type === 'video' ? 'video' : 'image' })),
    posted: post.stage === 'posted' ? postedWords(post) : null,
  }
}

/* ── who a client post can be emailed to ────────────────────────────────── */

/** One address a client send may go to: the business's own, then its people. */
export type SendChoice = { email: string; name: string; label: string; primary: boolean }

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/

export function cleanAddress(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return EMAIL.test(e) ? e : null
}

/**
 * The addresses a person may pick from when sending a post to the client —
 * the client's own, then its contacts, primary first, each once. The server
 * checks the same list; a typed address is never accepted.
 */
export function sendChoices(
  client: { name?: string | null; email?: string | null } | null | undefined,
  contacts: readonly { name?: string | null; email?: string | null; role?: string | null; is_primary?: boolean | null }[],
): SendChoice[] {
  const out: SendChoice[] = []
  const seen = new Set<string>()
  const add = (c: SendChoice) => { if (!seen.has(c.email)) { seen.add(c.email); out.push(c) } }
  const own = cleanAddress(client?.email)
  if (own) add({ email: own, name: String(client?.name ?? '').trim() || own, label: 'The business', primary: true })
  const people = [...contacts].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))
  for (const c of people) {
    const e = cleanAddress(c.email)
    if (!e) continue
    add({ email: e, name: String(c.name ?? '').trim() || e, label: String(c.role ?? '').trim() || (c.is_primary ? 'Main contact' : 'Contact'), primary: !!c.is_primary })
  }
  return out
}

/** The addresses ticked when the send dialog opens: the primary ones, or the first. */
export function defaultPicks(choices: readonly SendChoice[]): string[] {
  const primary = choices.filter(c => c.primary).map(c => c.email)
  return primary.length > 0 ? primary : choices.slice(0, 1).map(c => c.email)
}

/* ── edits ready to become posts (the tray above the board) ─────────────── */

/** What the tray reads off an edit card. */
export type SourceCard = {
  id: string
  client_id: string
  status: string
  adhoc_post?: unknown
  scheduler_ids?: unknown
  deliver_only?: boolean | null
  work_kinds?: { slug?: string | null } | null
  clients?: { posts_own_content?: boolean | null } | null
}

/**
 * EDITS READY TO BECOME POSTS (SPEC §4.2): an edit approved for posting, or
 * handed to a scheduler to post (the hand-over puts the card back at Draft for
 * them — its edit is finished), that has no live post yet. Never an upload
 * made on Schedule (that is a post from birth, audit V13), never a shoot plan,
 * never a piece the client posts themselves, and never an edit being revised
 * (audit B3, L5).
 */
export function readyToBecomePosts<T extends SourceCard>(items: readonly T[], sourcesWithPost: ReadonlySet<string>): T[] {
  return items.filter(i => {
    if (i.adhoc_post === true) return false
    if ((i.work_kinds?.slug ?? '') === 'shoot_brief') return false
    if (deliverOnly(i as never, (i.clients ?? null) as never)) return false
    if (sourcesWithPost.has(i.id)) return false
    const handed = Array.isArray(i.scheduler_ids) && i.scheduler_ids.length > 0
    return i.status === 'approved_for_scheduling' || (handed && i.status === 'draft_uploaded')
  })
}

/**
 * The source cards that already have a post that is not cancelled. A row the
 * migration has not given a stage yet counts as live: nothing here guesses a
 * post's place from any other field.
 */
export function sourcesWithLivePost(rows: readonly Record<string, unknown>[]): Set<string> {
  const out = new Set<string>()
  for (const r of rows) {
    const src = typeof r.source_item_id === 'string' && r.source_item_id ? r.source_item_id
      : typeof r.item_id === 'string' && r.item_id ? r.item_id : null
    if (src && r.stage !== 'cancelled') out.add(src)
  }
  return out
}
