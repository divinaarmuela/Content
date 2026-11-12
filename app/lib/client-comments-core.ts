/**
 * THE CLIENT'S RECENT COMMENTS, IN ONE LIST (12 Nov 2026, the owner: "add another view called comments … the recent
 * client comments … so the AM or quality check, super admins can see it"). Pure: rows in, rows out. A comment is the
 * client's when its author is the client; what they answered with it (Approved / Not approved) is read off the post.
 */
export type CommentIn = {
  id: string; post_id: string; client_id?: string | null; author_role?: string | null; author_name?: string | null
  body?: string | null; created_at?: string | null; version?: number | null
}
export type PostIn = {
  id: string; client_id: string; stage?: string | null; scheduled_for?: string | null; caption?: string | null
  source_item_id?: string | null; sent_version?: number | null
  client_review?: { verdict?: string; note?: string | null; version?: number; at?: string } | null
}
export type ClientCommentRow = {
  id: string; post_id: string; client_id: string; client: string; title: string
  author: string; body: string; at: string
  /** what they answered WITH these words — null for a comment sent on its own */
  answer: 'approved' | 'not_approved' | null
  stage: string | null; scheduled_for: string | null
  /** written on a version the post has moved past */
  earlier_version: boolean
}

/** who may open the view: account managers, quality checkers, super admins */
export function mayReadClientComments(user: { role?: string | null; quality_reviewer?: boolean | null }): boolean {
  return user.role === 'super_admin' || user.role === 'account_manager' || user.role === 'quality_checker' || user.quality_reviewer === true
}

export function clientCommentRows(input: {
  comments: readonly CommentIn[]; posts: readonly PostIn[]
  clientName: (id: string) => string | null | undefined
  itemTitle: (id: string) => string | null | undefined
  /** the clients this person may see — null = every client */
  allowed: ReadonlySet<string> | null
  limit?: number
}): ClientCommentRow[] {
  const postById = new Map(input.posts.map(p => [p.id, p]))
  const rows: ClientCommentRow[] = []
  for (const c of input.comments) {
    if (c.author_role !== 'client') continue
    const body = String(c.body ?? '').trim()
    const at = String(c.created_at ?? '')
    const post = postById.get(c.post_id)
    if (!body || !at || !post) continue
    if (input.allowed && !input.allowed.has(post.client_id)) continue
    const r = post.client_review
    const answer = r && String(r.note ?? '').trim() === body && (r.verdict === 'approved' || r.verdict === 'not_approved') ? r.verdict : null
    const title = String((post.source_item_id ? input.itemTitle(post.source_item_id) : '') ?? '').trim()
      || String(post.caption ?? '').split('\n').find(l => l.trim())?.slice(0, 60) || 'A post'
    rows.push({
      id: c.id, post_id: post.id, client_id: post.client_id, client: String(input.clientName(post.client_id) ?? '').trim() || 'Client',
      title, author: String(c.author_name ?? '').trim() || 'The client', body, at, answer,
      stage: post.stage ?? null, scheduled_for: post.scheduled_for ?? null,
      earlier_version: typeof c.version === 'number' && typeof post.sent_version === 'number' && c.version < post.sent_version,
    })
  }
  rows.sort((a, b) => b.at.localeCompare(a.at))
  return rows.slice(0, input.limit ?? 100)
}
