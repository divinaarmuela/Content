/**
 * COMMENTS, MESSAGES AND INSIGHTS THROUGH OUR OWN META APP — the pure half
 * (5 Oct 2026, the owner: "one big submission", "make sure we get all their
 * features"). Meta approves a permission only when the app itself uses it, so
 * a client with a direct connection (MetaDirectInstagram) gets its comments,
 * its direct messages and its numbers read and answered here, by a person.
 *
 * No I/O: what a request may ask for, and the shape of what Instagram answers.
 * Portable with meta-ig-core.ts / meta-ig-client.ts — nothing of MD Media's.
 * The server half is meta-ig-inbox.ts; the screen is MetaInstagramInbox.tsx.
 *
 * NOTHING HERE ANSWERS ON ITS OWN. Every reply, hide, delete and message is
 * one person pressing one button.
 *
 * Docs (read 5 Oct 2026): instagram-platform/comment-moderation,
 * instagram-api-with-instagram-login/conversations-api,
 * api-reference/instagram-user/insights.
 */

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const list = (v: unknown): any[] => (Array.isArray((v as { data?: unknown } | null)?.data) ? (v as { data: any[] }).data : [])

/* ── posts ────────────────────────────────────────────────────────────── */

export const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count'

export type IgPost = {
  id: string
  caption: string | null
  kind: string | null
  /** a picture to draw: the video's still for a video, the image otherwise */
  picture: string | null
  permalink: string | null
  postedAt: string | null
  comments: number | null
  likes: number | null
}

export function parsePosts(json: unknown): IgPost[] {
  return list(json).filter(m => m && m.id != null).map(m => ({
    id: String(m.id),
    caption: str(m.caption),
    kind: str(m.media_product_type) ?? str(m.media_type),
    picture: str(m.thumbnail_url) ?? (m.media_type === 'VIDEO' ? null : str(m.media_url)),
    permalink: str(m.permalink),
    postedAt: str(m.timestamp),
    comments: num(m.comments_count),
    likes: num(m.like_count),
  }))
}

/* ── comments ─────────────────────────────────────────────────────────── */

export const COMMENT_FIELDS = 'id,text,username,timestamp,hidden,like_count,from,replies{id,text,username,timestamp,hidden,from}'

export type IgThreadComment = {
  id: string
  text: string
  username: string | null
  at: string | null
  hidden: boolean
  likes: number | null
  /** written by the connected account itself (a reply of ours) */
  ours: boolean
  replies: IgThreadComment[]
}

function oneComment(c: any, ownUserId: string, ownUsername: string | null): IgThreadComment {
  const username = str(c?.username) ?? str(c?.from?.username)
  const fromId = c?.from?.id != null ? String(c.from.id) : null
  return {
    id: String(c.id),
    text: str(c.text) ?? '',
    username,
    at: str(c.timestamp),
    hidden: c.hidden === true,
    likes: num(c.like_count),
    ours: (fromId !== null && fromId === ownUserId) || (!!ownUsername && username === ownUsername),
    replies: list(c.replies).filter(r => r && r.id != null).map(r => oneComment(r, ownUserId, ownUsername))
      .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')),
  }
}

/**
 * Newest first; each comment's replies oldest first, the way a thread reads.
 *
 * Instagram lists a reply TWICE — once in the media's own list, with its
 * author, and once under its parent, where the author comes back empty (seen
 * live on 100M, 5 Oct 2026). So a reply is drawn once, under its parent, with
 * the name from its full copy.
 */
export function parseComments(json: unknown, own: { userId: string; username: string | null }): IgThreadComment[] {
  const all = list(json).filter(c => c && c.id != null).map(c => oneComment(c, own.userId, own.username))
  const full = new Map(all.map(c => [c.id, c]))
  const replyIds = new Set(all.flatMap(c => c.replies.map(r => r.id)))
  return all.filter(c => !replyIds.has(c.id)).map(c => ({
    ...c,
    replies: c.replies.map(r => {
      const copy = full.get(r.id)
      return copy ? { ...r, username: r.username ?? copy.username, ours: r.ours || copy.ours, likes: r.likes ?? copy.likes } : r
    }),
  })).sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
}

/* ── messages ─────────────────────────────────────────────────────────── */

export const CONVERSATION_FIELDS = 'id,updated_time,messages.limit(20){id,created_time,from,to,message}'

export type IgMessage = { id: string; text: string; at: string | null; fromId: string | null; fromName: string | null; ours: boolean }
export type IgConversation = {
  id: string
  updatedAt: string | null
  /** the person on the other side: who a message from here is sent to */
  personId: string | null
  personName: string | null
  /** oldest first */
  messages: IgMessage[]
  /** when they last wrote — Instagram lets the account answer for 24 hours after it */
  lastFromThemAt: string | null
}

/**
 * One conversation as Instagram answers it. Instagram gives the details of
 * the 20 most recent messages only (Conversations API), so that is the thread.
 */
export function parseConversation(c: any, ownUserId: string): IgConversation | null {
  if (!c || c.id == null) return null
  const messages: IgMessage[] = list(c.messages).filter(m => m && m.id != null).map(m => {
    const fromId = m.from?.id != null ? String(m.from.id) : null
    return {
      id: String(m.id), text: str(m.message) ?? '', at: str(m.created_time),
      fromId, fromName: str(m.from?.username), ours: fromId === ownUserId,
    }
  }).sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))

  // the other person: whoever wrote a message that is not ours, else whoever ours was sent to
  let personId: string | null = null
  let personName: string | null = null
  const theirs = [...messages].reverse().find(m => !m.ours && m.fromId)
  if (theirs) { personId = theirs.fromId; personName = theirs.fromName }
  else {
    for (const m of list(c.messages)) {
      const to = list(m?.to).find(t => t && t.id != null && String(t.id) !== ownUserId)
      if (to) { personId = String(to.id); personName = str(to.username); break }
    }
  }
  return {
    id: String(c.id),
    updatedAt: str(c.updated_time),
    personId, personName, messages,
    lastFromThemAt: theirs?.at ?? null,
  }
}

export function parseConversations(json: unknown, ownUserId: string): IgConversation[] {
  return list(json).map(c => parseConversation(c, ownUserId)).filter((c): c is IgConversation => !!c)
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
}

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

/** May the account write to this person now? Instagram allows it for 24 hours after their last message. */
export function replyWindowOpen(lastFromThemAt: string | null, now: number): boolean {
  if (!lastFromThemAt) return false
  const t = Date.parse(lastFromThemAt)
  return Number.isFinite(t) && now - t < REPLY_WINDOW_MS
}

/* ── insights ─────────────────────────────────────────────────────────── */

/** `metric_type=total_value`, `period=day` (api-reference/instagram-user/insights). `impressions` is gone; `views` replaced it. */
export const ACCOUNT_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves'] as const
export const POST_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const

export const METRIC_WORDS: Record<string, string> = {
  reach: 'Accounts reached',
  views: 'Views',
  accounts_engaged: 'Accounts engaged',
  total_interactions: 'Interactions',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
  saves: 'Saves',
  saved: 'Saves',
}

export type Insight = { metric: string; label: string; value: number | null }

/**
 * Both shapes Instagram answers with: `total_value: { value }` (account
 * totals) and `values: [{ value }]` (a post's numbers, or a time series,
 * which is summed).
 */
export function parseInsights(json: unknown, order: readonly string[]): Insight[] {
  const byName = new Map<string, number | null>()
  for (const row of list(json)) {
    const name = str(row?.name)
    if (!name) continue
    let value = num(row?.total_value?.value)
    if (value === null && Array.isArray(row?.values)) {
      const nums = row.values.map((v: any) => num(v?.value)).filter((n: number | null): n is number => n !== null)
      value = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) : null
    }
    byName.set(name, value)
  }
  return order.filter(m => byName.has(m)).map(m => ({ metric: m, label: METRIC_WORDS[m] ?? m, value: byName.get(m) ?? null }))
}

export const INSIGHT_DAYS = [7, 28] as const
export type InsightDays = typeof INSIGHT_DAYS[number]

/** The `since` / `until` of the last N days, in seconds. Instagram refuses a range over 30 days. */
export function insightRange(days: number, now: number): { since: number; until: number } {
  const d = (INSIGHT_DAYS as readonly number[]).includes(days) ? days : 7
  const until = Math.floor(now / 1000)
  return { since: until - d * 24 * 60 * 60, until }
}

export type IgProfile = { username: string | null; name: string | null; picture: string | null; followers: number | null; posts: number | null }
export const PROFILE_FIELDS = 'user_id,username,name,profile_picture_url,followers_count,media_count'
export function parseProfile(json: unknown): IgProfile {
  const j = (json ?? {}) as Record<string, unknown>
  return { username: str(j.username), name: str(j.name), picture: str(j.profile_picture_url), followers: num(j.followers_count), posts: num(j.media_count) }
}

/* ── what a person may ask the app to do ──────────────────────────────── */

export const INBOX_ACTIONS = ['reply', 'hide', 'unhide', 'delete', 'private_reply', 'message'] as const
export type InboxAction = typeof INBOX_ACTIONS[number]

/** Instagram's own limits: a comment 2,200 characters (as a caption), a message 1,000. */
export const COMMENT_MAX = 2200
export const MESSAGE_MAX = 1000

export type InboxRequest =
  | { action: 'reply'; commentId: string; text: string }
  | { action: 'hide' | 'unhide' | 'delete'; commentId: string }
  | { action: 'private_reply'; commentId: string; text: string }
  | { action: 'message'; recipientId: string; text: string }

const idLike = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : ''
  // Graph ids are digits, or digits and letters with _ and - (message and conversation ids)
  return /^[A-Za-z0-9_\-=.]{1,300}$/.test(s) ? s : null
}

/** A request body → what to do, or the sentence that refuses it. */
export function readInboxRequest(body: unknown): { ok: true; value: InboxRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const action = b.action as InboxAction
  if (!INBOX_ACTIONS.includes(action)) return { ok: false, error: 'Unknown action' }
  const text = typeof b.text === 'string' ? b.text.trim() : ''

  if (action === 'message') {
    const recipientId = idLike(b.recipientId)
    if (!recipientId) return { ok: false, error: 'Choose a conversation to write in' }
    if (!text) return { ok: false, error: 'Write a message first' }
    if (text.length > MESSAGE_MAX) return { ok: false, error: `A message is at most ${MESSAGE_MAX} characters` }
    return { ok: true, value: { action, recipientId, text } }
  }

  const commentId = idLike(b.commentId)
  if (!commentId) return { ok: false, error: 'Choose a comment first' }
  if (action === 'reply' || action === 'private_reply') {
    if (!text) return { ok: false, error: action === 'reply' ? 'Write a reply first' : 'Write a message first' }
    const max = action === 'reply' ? COMMENT_MAX : MESSAGE_MAX
    if (text.length > max) return { ok: false, error: `That is over ${max} characters` }
    return { ok: true, value: { action, commentId, text } }
  }
  return { ok: true, value: { action, commentId } }
}

export const INBOX_VIEWS = ['posts', 'comments', 'messages', 'insights'] as const
export type InboxView = typeof INBOX_VIEWS[number]

export function readGraphId(v: unknown): string | null { return idLike(v) }
