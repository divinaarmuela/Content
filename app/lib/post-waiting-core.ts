/**
 * WAITING ON YOU — the posts somebody is held up by (SPEC §4.2; the posting
 * rebuild, 29 Sep 2026).
 *
 * The old list read the edit card's post-approval field, so a post the
 * client sent back never appeared (audit B8: the 'changes' state fell through
 * every branch), a post emailed to the client sat under "waiting on you" for
 * the manager, and "since" was the card's last touch (B14).
 *
 * Here every row is a POST, read off `post.stage` through `waitingOn` and
 * `waitingOnViewer` (post-stage-core) — the same rule the card face says. A
 * draft with a change asked for is waiting on the named person; a post with
 * the quality check is waiting on the reviewers; a post with the client is
 * the client's, shown but never answered here; a missed time is the
 * manager's. The buttons on a row are the card's own (`boardActions`), so a
 * row never offers a press the server would refuse.
 *
 * No I/O, no React; the clock is passed in, so a page that ticks re-reads it
 * (audit S12).
 */

import {
  hatsFor, waitingOnViewer,
  type NowLike, type OfferedAction, type PostState, type TransitionContext, type Viewer,
} from './post-stage-core'
import { boardActions, type PostCardFace } from './post-board-core'

/** What a row is drawn from: the card's own face and the rules' context, worked out once by the page. */
export type WaitingInput = { face: PostCardFace; ctx?: Omit<TransitionContext, 'now'> }

export type PostWaitingRow = {
  /** the post's id */
  id: string
  post: PostState
  face: PostCardFace
  /** true when THIS viewer is the one holding it up */
  onYou: boolean
  /** the buttons this viewer may press on the row: the card's main one, and Ask for a change */
  actions: OfferedAction[]
  /** the sort key: when the post entered its stage (never shown) */
  stamp: string | null
}

/** The stages a post can be waiting on somebody in, on this page. */
const WAITING_STAGES = ['draft', 'quality_check', 'with_client', 'ready'] as const

/**
 * One post, weighed. Null when nobody is held up by it — a draft nobody has
 * sent and nobody asked to change is still being made, and a booked or posted
 * post is not waiting on a person.
 */
export function postWaitingRow(
  post: PostState,
  viewer: Viewer & { id: string },
  now: NowLike,
  opts: WaitingInput,
): PostWaitingRow | null {
  if (!(WAITING_STAGES as readonly string[]).includes(post.stage)) return null
  const hats = hatsFor(viewer, post)
  const onYou = waitingOnViewer(post, { id: viewer.id, hats }, now)
  // a draft is somebody's work in progress: it is WAITING only once a change
  // was asked for, and then only on the person asked (audit B8)
  if (post.stage === 'draft' && !post.changes_asked && !onYou) return null
  if (post.stage === 'draft' && !post.changes_asked && post.sent_version == null) return null
  // Ready to post is the Schedule page's queue — here only when it came back with a problem for this person
  if (post.stage === 'ready' && !(onYou && post.problem)) return null
  const list = boardActions(post, hats, now, opts.ctx ?? {})
  const actions: OfferedAction[] = []
  if (onYou) {
    if (list.primary) actions.push(list.primary)
    const ask = list.secondary.find(a => a.action === 'ask_change')
    if (ask) actions.push(ask)
  }
  return {
    id: post.id,
    post,
    face: opts.face,
    onYou,
    actions,
    stamp: post.stage_at,
  }
}

/**
 * Every post waiting on somebody, this viewer's own first, the longest wait at
 * the top of each half.
 */
export function postWaitingRows(
  posts: readonly PostState[],
  viewer: Viewer & { id: string },
  now: NowLike,
  optsFor: (post: PostState) => WaitingInput,
): PostWaitingRow[] {
  const rows: PostWaitingRow[] = []
  for (const p of posts) {
    const row = postWaitingRow(p, viewer, now, optsFor(p))
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => {
    if (a.onYou !== b.onYou) return a.onYou ? -1 : 1
    const at = a.stamp ?? '', bt = b.stamp ?? ''
    if (at !== bt) return at < bt ? -1 : 1
    return a.face.title.localeCompare(b.face.title)
  })
}

/** "3 waiting on you · 2 with someone else" — the heading is the count. */
export function postWaitingTitle(rows: readonly PostWaitingRow[]): string {
  const mine = rows.filter(r => r.onYou).length
  const others = rows.length - mine
  if (mine === 0 && others === 0) return 'Nothing is waiting'
  if (mine === 0) return `${others} waiting on someone else`
  const head = `${mine} waiting on you`
  return others === 0 ? head : `${head} · ${others} with someone else`
}

/** What the folded half is called — "2 more, with the client". */
export function postOthersLabel(others: readonly PostWaitingRow[]): string {
  if (others.length === 0) return ''
  const who = others.every(r => r.post.stage === 'with_client' && !r.face.missed) ? 'with the client'
    : others.every(r => r.post.stage === 'quality_check') ? 'with the quality check'
    : 'with someone else'
  return others.length === 1 ? `1 more, ${who}` : `${others.length} more, ${who}`
}
