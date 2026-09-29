'use client'

/**
 * THE POST WINDOW'S SERVER CALLS — the fetch half of `PostWindowApi`
 * (app/lib/post-window-core.ts). Kept in one small file so the window's tests
 * can hand in a fake, and so package P1 (which owns the routes) can see in one
 * place exactly what the window sends and reads back:
 *
 *   create  POST  /api/social/schedule        {item_id, slides, caption, channels, per_channel, scheduled_for, timezone}
 *                 → {post: <the raw social_posts row, with its stage and rev>}
 *   save    PATCH /api/social/schedule/<id>   {expect_rev, …the same working copy}
 *                 → {post: <raw row>} — only while the post is a draft
 *   act     POST  /api/posts/<id>/act         PostActRequest (post-act-contract)
 *                 → PostActResponse
 *   note    POST  /api/posts/<id>/comments    NoteInput → {comment}
 *
 * A refusal from any of them comes back as words for the button that was
 * pressed — never thrown past the window.
 */

import { postActPath, type PostActRequest, type PostActResponse } from '@/app/lib/post-act-contract'
import type { NoteInput, PostWindowApi, SaveResponse, WorkingBody } from '@/app/lib/post-window-core'
import { friendlyError } from '@/app/lib/support-core'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json()
    return j && typeof j === 'object' ? j as Record<string, unknown> : {}
  } catch { return {} }
}

function refusalOf(json: Record<string, unknown>, what: string): { reason: string; problems: string[] } {
  const problems = Array.isArray(json.problems) ? json.problems.filter((p): p is string => typeof p === 'string') : []
  const reason = typeof json.reason === 'string' && json.reason
    ? json.reason
    : problems[0] ?? friendlyError(typeof json.error === 'string' ? json.error : '', what)
  return { reason, problems }
}

async function saveCall(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<SaveResponse> {
  const res = await fetch(url, { method, headers: JSON_HEADERS, body: JSON.stringify(body) })
  const json = await readJson(res)
  const row = json.post && typeof json.post === 'object' ? json.post as Record<string, unknown> : null
  if (res.ok && row) return { ok: true, row }
  return { ok: false, ...refusalOf(json, 'this post'), row }
}

export const postWindowApi: PostWindowApi = {
  create: (body: WorkingBody & { item_id: string }) => saveCall('/api/social/schedule', 'POST', body),
  save: (postId: string, body: WorkingBody & { expect_rev: number }) =>
    saveCall(`/api/social/schedule/${encodeURIComponent(postId)}`, 'PATCH', body),
  async act(postId: string, req: PostActRequest): Promise<PostActResponse> {
    const res = await fetch(postActPath(postId), { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(req) })
    const json = await readJson(res)
    if (res.ok && json.ok === true) return json as unknown as PostActResponse
    const { reason, problems } = refusalOf(json, 'this post')
    return {
      ok: false,
      code: (typeof json.code === 'string' ? json.code : 'bad_request') as never,
      reason,
      ...(problems.length > 0 ? { problems } : {}),
      post: (json.post && typeof json.post === 'object' ? json.post : null) as never,
    }
  },
}

/** Add a note to a post — Team thread unless someone chose the Client thread. */
export async function addPostNote(postId: string, note: NoteInput): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(note),
    })
    if (res.ok) return { ok: true }
    return { ok: false, reason: refusalOf(await readJson(res), 'the note').reason }
  } catch {
    return { ok: false, reason: 'The note did not reach the server. Check the connection and try again.' }
  }
}
