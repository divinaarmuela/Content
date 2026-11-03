/**
 * THE INBOX'S CLIENT LIST, NEWEST ACTIVITY FIRST (the owner, 3 Nov 2026: "make it easy per client … whichever has
 * the latest notification will go up"). Pure: no I/O, so the order and the "new" count are tested, not hoped for.
 *
 * Built from our own records, not the posting service: every comment and DM Zernio's webhook delivers is noted in
 * `inbox_touches` (one row per person per account, with `client_id` and `last_at`), so this reads in one database
 * call where Zernio's cross-account list took 17 s cold (read live 3 Nov 2026).
 *
 * "New" is per person: the people who commented or messaged a client after THIS person last opened it
 * (`inbox_views`), so Abby opening a client does not clear it for Karly. Someone who has never opened a client
 * counts the last day only — a first visit should not read "433 new".
 */

export type ClientPick = { id: string; name: string; accounts: { id: string; platform: string; username: string | null }[] }
export type TouchLite = { client_id?: string | null; last_at?: string | null; kind?: string | null }
export type ViewLite = { client_id: string; seen_at: string }
export type RankedClient = ClientPick & {
  /** when anyone last commented or messaged this client's accounts, or null when nobody has */
  last_at: string | null
  last_kind: 'comment' | 'message' | null
  /** people who commented or messaged since this person last opened the client */
  new_count: number
  /** …split, so the list can say "3 messages · 2 comments" and you know which tab to open */
  new_messages: number
  new_comments: number
}

export const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000

export function rankClients(
  clients: readonly ClientPick[],
  touches: readonly TouchLite[],
  views: readonly ViewLite[],
  now: Date = new Date(),
): RankedClient[] {
  const seen = new Map(views.map(v => [v.client_id, v.seen_at]))
  const firstVisitFrom = new Date(now.getTime() - FIRST_VISIT_WINDOW_MS).toISOString()
  const latest = new Map<string, { at: string; kind: string | null }>()
  const fresh = new Map<string, number>()
  const freshMsg = new Map<string, number>()
  const freshCom = new Map<string, number>()
  for (const t of touches) {
    if (!t.client_id || !t.last_at) continue
    const prev = latest.get(t.client_id)
    if (!prev || t.last_at > prev.at) latest.set(t.client_id, { at: t.last_at, kind: t.kind ?? null })
    const since = seen.get(t.client_id) ?? firstVisitFrom
    if (t.last_at > since) {
      fresh.set(t.client_id, (fresh.get(t.client_id) ?? 0) + 1)
      const box = t.kind === 'comment' ? freshCom : freshMsg
      box.set(t.client_id, (box.get(t.client_id) ?? 0) + 1)
    }
  }
  return clients
    .map((c): RankedClient => {
      const l = latest.get(c.id)
      const kind = l?.kind === 'comment' || l?.kind === 'message' ? l.kind : null
      return {
        ...c, last_at: l?.at ?? null, last_kind: kind, new_count: fresh.get(c.id) ?? 0,
        new_messages: freshMsg.get(c.id) ?? 0, new_comments: freshCom.get(c.id) ?? 0,
      }
    })
    // newest activity first; a client nobody has written to goes last, by name
    .sort((x, y) => {
      if (x.last_at && y.last_at && x.last_at !== y.last_at) return x.last_at < y.last_at ? 1 : -1
      if (x.last_at && !y.last_at) return -1
      if (!x.last_at && y.last_at) return 1
      return x.name.localeCompare(y.name)
    })
}

/** "just now", "4 min ago", "3 h ago", "2 d ago" — short enough for a chip */
export function agoLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return 'No activity yet'
  const ms = now.getTime() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 60_000) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/** "3 messages · 1 comment", or "" when nothing is new */
export function newWords(c: { new_messages: number; new_comments: number }): string {
  const parts: string[] = []
  if (c.new_messages) parts.push(`${c.new_messages} message${c.new_messages === 1 ? '' : 's'}`)
  if (c.new_comments) parts.push(`${c.new_comments} comment${c.new_comments === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * THE COMMENTS TAB, BY LATEST COMMENT (the owner, 3 Nov 2026: "comments should be for which post"): each post gets
 * the time of its newest comment we were told about (inbox_touches.post_id is the same id Zernio lists the post by —
 * checked live 3 Nov 2026) and how many people commented on it since this person last opened that client. Posts are
 * then ordered by that latest comment, falling back to when the post went up.
 */
export type PostLite = { id: string; createdTime?: string }
export function byLatestComment<P extends PostLite>(
  posts: readonly P[],
  touches: readonly (TouchLite & { post_id?: string | null })[],
  seenAt: (clientId: string | null | undefined) => string,
): (P & { last_comment_at: string | null; new_comments: number })[] {
  const latest = new Map<string, string>()
  const fresh = new Map<string, number>()
  for (const t of touches) {
    if (t.kind !== 'comment' || !t.post_id || !t.last_at) continue
    if ((latest.get(t.post_id) ?? '') < t.last_at) latest.set(t.post_id, t.last_at)
    if (t.last_at > seenAt(t.client_id)) fresh.set(t.post_id, (fresh.get(t.post_id) ?? 0) + 1)
  }
  const when = (p: P & { last_comment_at: string | null }) => p.last_comment_at ?? p.createdTime ?? ''
  return posts
    .map(p => ({ ...p, last_comment_at: latest.get(p.id) ?? null, new_comments: fresh.get(p.id) ?? 0 }))
    .sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0))
}
