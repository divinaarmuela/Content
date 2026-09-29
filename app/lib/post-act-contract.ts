/**
 * THE ACT ROUTE'S CONTRACT — pure types and one parser, shared by the server
 * (package P1: `app/api/posts/[id]/act/route.ts`), the post window and the
 * boards (P3, P5), and the portal (P6). The only I/O is `postAct`, the one
 * browser call every page makes to the route.
 *
 * One route moves a post: `POST /api/posts/<id>/act` with `{action, expect_rev, …}`.
 * It answers `{ok: true, post, stage, words}` or a refusal with the fresh post,
 * so a page always redraws from what the server holds — never from what it
 * assumed would happen (audit W4: "Booked in for …" shown for a booking that
 * failed). The toast is `words`, built from the stage the post LANDED in
 * (audit B9).
 *
 * There is deliberately no "send it to the client unchecked" flag: the quality
 * check is required (OWNER_DECISIONS.md, decision 3).
 */

import {
  AGREED_VIA, APPROVAL_STEPS, CLIENT_ACTIONS, POST_ACTIONS, SYSTEM_ACTIONS, isPostAction,
  type AgreedVia, type ApprovalSteps, type PostAction, type PostStage, type PostState, type RefusalCode,
} from './post-stage-core'
import { friendlyError } from './support-core'

/** The URL a page posts to for one post. */
export function postActPath(postId: string): string {
  return `/api/posts/${encodeURIComponent(postId)}/act`
}

/**
 * THE ONE CALL A PAGE MAKES TO MOVE A POST — Post approval's buttons, the
 * Schedule page and the post window all send through here. It never throws:
 * a refusal, a body that is not an answer, or a dropped connection all come
 * back as a refusal whose `reason` is the sentence to show by the button.
 */
export async function postAct(postId: string, request: PostActRequest): Promise<PostActResponse> {
  let res: Response
  try {
    res = await fetch(postActPath(postId), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
  } catch {
    return { ok: false, code: 'bad_request', reason: 'Could not reach the server. Nothing has changed — try again.', post: null }
  }
  const json: unknown = await res.json().catch(() => null)
  if (isObj(json) && json.ok === true) return json as unknown as PostActOk
  const body = isObj(json) ? json : {}
  const problems = Array.isArray(body.problems) ? body.problems.filter((p): p is string => typeof p === 'string') : []
  const said = [body.reason, problems[0]].find((x): x is string => typeof x === 'string' && x.trim().length > 0)
    ?? (typeof body.error === 'string' && body.error.trim() ? friendlyError(body.error, 'this post') : undefined)
  const reason = said
    ?? (res.status === 404 ? 'That post is not there any more — it may have been deleted.' : 'That did not go through. Nothing has changed — try again.')
  return {
    ok: false,
    code: (typeof body.code === 'string' ? body.code : res.status === 404 ? 'not_found' : 'bad_request') as PostActRefused['code'],
    reason,
    ...(problems.length > 0 ? { problems } : {}),
    post: (isObj(body.post) ? body.post : null) as PostState | null,
  }
}

/** The moves a TEAM member makes through the act route. The client's go through the portal; the app's never come in over HTTP. */
export const TEAM_ACT_ACTIONS: readonly PostAction[] =
  POST_ACTIONS.filter(a => !SYSTEM_ACTIONS.includes(a) && !CLIENT_ACTIONS.includes(a))

/** The body of `POST /api/posts/<id>/act`. */
export type PostActRequest = {
  action: PostAction
  /** the `rev` the page drew; a mismatch is refused with the fresh post */
  expect_rev: number
  /** the frozen version the person looked at (reviewer, manager for the client) */
  version?: number | null
  note?: string | null
  /** a new posting time (Change time, New time and resend) — an ISO instant */
  scheduled_for?: string | null
  /** when the client's approval closes; the server defaults it from the posting time */
  approve_by?: string | null
  /** Approve for the client: how the client said yes */
  agreed_via?: AgreedVia | null
  /** Ask for a change: who makes it; defaults to the post's maker */
  assign_to?: string | null
  /** the answer to the window's question (cancel, delete, edit a booked post, post now) */
  confirm?: boolean | null
  /** Change approval steps */
  steps?: ApprovalSteps | null
  /** client sends: who to email (the server delivers, THEN moves the post) */
  send_to?: string[] | null
  /** client sends: 'link' when the person copies the link instead of emailing */
  via?: 'email' | 'link' | null
  reason?: string | null
}

/** The body of the portal's post decision (`api/portal/act`, P6). */
export type PortalPostActRequest = {
  action: 'client_approve' | 'client_ask_change'
  post_id: string
  version: number
  note?: string | null
}

export type PostActOk = {
  ok: true
  /** the post as it now stands — draw from this, never from an assumption */
  post: PostState
  stage: PostStage | 'deleted'
  /** "Passed — now in Ready to post" */
  words: string
  /** the post a move made (Post the missing networks, Duplicate) — the page can open it */
  created_post_id?: string
  /** a client send by copied link: the client's page, for the person to paste */
  link?: string
}

export type PostActRefused = {
  ok: false
  code: RefusalCode | 'bad_request' | 'not_found'
  /** the sentence to show next to the button that was pressed */
  reason: string
  /** every problem, when there were several (the composition check) */
  problems?: string[]
  /** the fresh post, so the page redraws from what the server holds */
  post: PostState | null
}

export type PostActResponse = PostActOk | PostActRefused

/**
 * The HTTP status for a refusal: 403 when the person may not do it, 404 when
 * there is no such post, 400 for a body that is not a request, and 409 for
 * everything else — the post is not in a state where this can happen, and the
 * fresh post comes back with it.
 */
export function refusalStatus(code: PostActRefused['code']): number {
  if (code === 'not_allowed') return 403
  if (code === 'not_found') return 404
  if (code === 'bad_request' || code === 'unknown_action') return 400
  return 409
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optStr = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : typeof v === 'string' ? v : undefined
const isIsoTime = (v: string) => Number.isFinite(new Date(v).getTime())

/**
 * Read a request body into a `PostActRequest`, or say what is wrong with it.
 * Strict on shape, silent on meaning: whether the move is allowed is
 * `checkPostTransition`'s job, not this parser's.
 */
export function parsePostActRequest(body: unknown): { ok: true; request: PostActRequest } | { ok: false; reason: string } {
  if (!isObj(body)) return { ok: false, reason: 'The request has no body.' }
  const action = body.action
  if (!isPostAction(action) || !TEAM_ACT_ACTIONS.includes(action)) return { ok: false, reason: 'That is not something this page can do to a post.' }
  const rev = body.expect_rev
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) return { ok: false, reason: 'The page did not say which copy of the post it had — reload and try again.' }
  const request: PostActRequest = { action, expect_rev: rev }

  if (body.version !== undefined && body.version !== null) {
    if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) return { ok: false, reason: 'The version is not a number.' }
    request.version = body.version
  }
  for (const key of ['note', 'assign_to', 'reason'] as const) {
    const v = optStr(body[key])
    if (body[key] !== undefined && v === undefined) return { ok: false, reason: `"${key}" has to be text.` }
    if (v !== undefined) request[key] = v === null ? null : v.slice(0, 4000)
  }
  for (const key of ['scheduled_for', 'approve_by'] as const) {
    const v = optStr(body[key])
    if (body[key] !== undefined && v === undefined) return { ok: false, reason: `"${key}" has to be a time.` }
    if (v) {
      if (!isIsoTime(v)) return { ok: false, reason: 'That is not a time we can read — pick one from the calendar.' }
      request[key] = new Date(v).toISOString()
    } else if (v === null) request[key] = null
  }
  if (body.agreed_via !== undefined && body.agreed_via !== null) {
    if (!(AGREED_VIA as readonly unknown[]).includes(body.agreed_via)) return { ok: false, reason: 'Say how the client agreed.' }
    request.agreed_via = body.agreed_via as AgreedVia
  }
  if (body.steps !== undefined && body.steps !== null) {
    if (!(APPROVAL_STEPS as readonly unknown[]).includes(body.steps)) return { ok: false, reason: 'Choose team only, or team then the client.' }
    request.steps = body.steps as ApprovalSteps
  }
  if (body.confirm !== undefined && body.confirm !== null) {
    if (typeof body.confirm !== 'boolean') return { ok: false, reason: '"confirm" has to be yes or no.' }
    request.confirm = body.confirm
  }
  if (body.via !== undefined && body.via !== null) {
    if (body.via !== 'email' && body.via !== 'link') return { ok: false, reason: 'Send by email or by link.' }
    request.via = body.via
  }
  if (body.send_to !== undefined && body.send_to !== null) {
    if (!Array.isArray(body.send_to) || !body.send_to.every(x => typeof x === 'string')) return { ok: false, reason: '"send_to" has to be a list of addresses.' }
    request.send_to = [...new Set((body.send_to as string[]).map(x => x.trim()).filter(Boolean))].slice(0, 20)
  }
  return { ok: true, request }
}
