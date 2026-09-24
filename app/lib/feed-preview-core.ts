/**
 * THE FEED AS IT WILL LOOK — the pure half (the owner, 24 Sep 2026, pointing
 * at Later's visual Instagram planner: "cant u see the link i shared").
 *
 * Our Preview drew only the posts made here, so an account with three drafts
 * showed three tiles against nothing — no use for judging how the next post
 * sits in the grid. A planner shows what is already up. The account's own
 * published posts are read from the platform (25 most recent, everything on
 * the account, not only what went out through this dashboard) and drawn under
 * what we have planned, so the grid reads as one continuous feed: the next
 * post top left, then the rest, then what is already live.
 *
 * No I/O.
 */

export type PlannedTile = {
  kind: 'planned'
  id: string
  /** null when it has no time yet — a draft leads the grid */
  at: string | null
  status: string
  title: string | null
  thumbnail: string | null
}

export type LiveTile = {
  kind: 'live'
  id: string
  at: string | null
  /** the post on the platform, so a tile can be opened where it really lives */
  permalink: string | null
  thumbnail: string | null
  mediaType: string | null
  likes: number | null
  comments: number | null
  caption: string
}

export type FeedTile = PlannedTile | LiveTile

/** one post as the provider hands it back */
export type ProviderPost = {
  id?: unknown
  message?: unknown
  createdTime?: unknown
  picture?: unknown
  permalink?: unknown
  mediaType?: unknown
  likeCount?: unknown
  commentCount?: unknown
}

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** the account's own posts, newest first, only the ones with a picture to draw */
export function liveTiles(raw: unknown, limit = 24): LiveTile[] {
  const list = Array.isArray((raw as { posts?: unknown })?.posts) ? (raw as { posts: ProviderPost[] }).posts : []
  return list
    .map(p => ({
      kind: 'live' as const,
      id: str(p.id),
      at: str(p.createdTime) || null,
      permalink: str(p.permalink) || null,
      thumbnail: str(p.picture) || null,
      mediaType: str(p.mediaType) || null,
      likes: num(p.likeCount),
      comments: num(p.commentCount),
      caption: str(p.message),
    }))
    .filter(t => t.id && t.thumbnail)
    .sort((a, b) => str(b.at).localeCompare(str(a.at)))
    .slice(0, limit)
}

/**
 * The grid: what we have planned, then what is already up.
 *
 * A planned post with no time yet leads, where the next post goes; the rest
 * run newest first, the order Instagram itself reads in. A live post that we
 * also hold as planned is dropped from the live half, so a post that went out
 * through this dashboard is not drawn twice.
 */
export function feedTiles(planned: readonly PlannedTile[], live: readonly LiveTile[]): FeedTile[] {
  const at = (p: PlannedTile) => Date.parse(String(p.at ?? ''))
  const undated = planned.filter(p => !Number.isFinite(at(p)))
  const dated = planned.filter(p => Number.isFinite(at(p))).sort((a, b) => at(b) - at(a))
  const ours = new Set(planned.map(p => p.thumbnail).filter(Boolean) as string[])
  return [...undated, ...dated, ...live.filter(l => !l.thumbnail || !ours.has(l.thumbnail))]
}

/** what the strip above the grid says, in plain words */
export function feedWords(plannedCount: number, liveCount: number, handle: string | null): string {
  const who = handle ? `@${handle}` : 'the account'
  if (liveCount === 0 && plannedCount === 0) return 'Nothing planned yet, so there is nothing to preview.'
  if (liveCount === 0) return `${plannedCount} planned. ${who}’s own posts could not be read, so the grid below is only what is planned.`
  const p = plannedCount === 1 ? '1 planned post' : `${plannedCount} planned posts`
  return `${p} above ${who}’s feed as it is now.`
}
