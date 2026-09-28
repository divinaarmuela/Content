/**
 * THE PEOPLE CRM — one row per person on a client's Instagram, every touch on a timeline (the owner, 28 Sep 2026:
 * "a page like this — rows, data per user: new follower, interactions — only for Justin and Jordan — a CRM based on
 * post liked etc — if DMed — track every touch point — view DM — interacted").
 *
 * Pure: it reshapes the rows `buildPeople` (people-analytics-core) already joins — followers, the likes and comments
 * on our posts, and the Inbox — into the screenshot's shape: a status, first seen, last active, the counts, and a
 * dated activity list. Nothing is invented: a day we do not know is left out, never guessed. Instagram gives no time
 * for a like or a follow, so each is dated by the only honest day there is (the post's day; the look that first saw
 * them follow) and the page says so.
 */
import type { PeopleRow } from './people-analytics-core'

/**
 * The clients the page is for (the owner, 28 Sep 2026: "only for Justin and Jordan"). Add an id to open it to
 * another client — everything below works for any client with Instagram connected.
 */
export const PEOPLE_CRM_CLIENTS: readonly { id: string; name: string }[] = [
  { id: '2e27f9e4-9cb5-43a6-a06b-f317f207a1e8', name: 'Justin Engelke' },
  { id: 'eb550318-b5a4-4dd6-81ea-9310588a55bb', name: 'Jordan Wilson' },
]

export type CrmStatus = 'dmed' | 'commented' | 'liked' | 'new_follower' | 'follower' | 'unfollowed' | 'ours'

export const CRM_STATUS_WORDS: Record<CrmStatus, string> = {
  dmed: 'DMed',
  commented: 'Commented',
  liked: 'Liked',
  new_follower: 'New follower',
  follower: 'Follower',
  unfollowed: 'Unfollowed',
  ours: 'Our account',
}

export type CrmEvent = {
  /** what happened, as a person says it */
  what: string
  /** the post, or the note beside it */
  detail: string | null
  /** YYYY-MM-DD */
  day: string
  /** the exact instant, when the provider gave one (a comment, a DM) — a time is shown beside the day */
  at?: string | null
  /** where the detail opens — the post's page, or the Inbox on this person */
  href: string | null
  /** a word for the link */
  link: string | null
  tone: 'strong' | 'plain' | 'lost'
}

export type CrmRow = {
  key: string
  username: string
  full_name: string | null
  profile_pic: string | null
  profile_href: string
  inbox_href: string
  status: CrmStatus
  /** the post they touched before they followed — "Likely from ‘Title’" */
  from_post: string | null
  first_seen: string | null
  last_active: string | null
  likes: number
  comments: number
  dmed: boolean
  following: boolean
  /** newest first */
  timeline: CrmEvent[]
}

const max = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)
const min = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b)

/** one person, as the CRM draws them. `ours` = handles that are the team's or the client's own accounts */
export function crmRow(p: PeopleRow, ours: ReadonlySet<string> = new Set()): CrmRow {
  const timeline: CrmEvent[] = []
  let likes = 0
  let comments = 0
  for (const a of p.actions) {
    const liked = a.kind === 'liked' || a.kind === 'liked and commented'
    const commented = a.kind === 'commented' || a.kind === 'liked and commented'
    if (liked) likes++
    if (commented) comments++
    if (!a.day) continue
    if (commented) timeline.push({ what: a.text ? `Commented “${a.text}”` : 'Commented on a post', detail: a.title, day: a.day, at: a.at ?? null, href: a.href, link: a.href ? 'Open the post' : null, tone: 'strong' })
    if (liked) timeline.push({ what: 'Liked a post', detail: a.title, day: a.day, href: a.href, link: a.href ? 'Open the post' : null, tone: 'plain' })
  }
  const dmed = p.reached_out_how === 'message' || p.reached_out_how === 'both'
  const inboxComment = p.reached_out_how === 'comment' || p.reached_out_how === 'both'
  if (p.reached_out_on) {
    if (dmed) timeline.push({ what: 'Sent a DM', detail: p.reached_out_first_on && p.reached_out_first_on !== p.reached_out_on ? `first on ${p.reached_out_first_on}` : null, day: p.reached_out_on, href: p.inbox_href, link: 'View DM', tone: 'strong' })
    else if (inboxComment) timeline.push({ what: 'Commented (seen in the Inbox)', detail: null, day: p.reached_out_on, href: p.inbox_href, link: 'Open in Inbox', tone: 'plain' })
  }
  if (p.followed_on) timeline.push({ what: 'Started following', detail: p.from_us.likely && p.from_us.title ? `after ${p.from_us.title}` : null, day: p.followed_on, href: null, link: null, tone: 'strong' })
  if (p.gone_on) timeline.push({ what: 'Unfollowed', detail: null, day: p.gone_on, href: null, link: null, tone: 'lost' })
  timeline.sort((a, b) => (a.day === b.day ? String(b.at ?? '').localeCompare(String(a.at ?? '')) : a.day < b.day ? 1 : -1))

  const days = timeline.map(e => e.day)
  const first = days.reduce<string | null>((m, d) => min(m, d), p.reached_out_first_on ?? null)
  const last = days.reduce<string | null>((m, d) => max(m, d), null)
  const following = p.follows === true

  const status: CrmStatus = ours.has(p.key) ? 'ours'
    : dmed ? 'dmed'
    : comments > 0 || inboxComment ? 'commented'
    : likes > 0 ? 'liked'
    : p.gone_on ? 'unfollowed'
    : p.followed_on ? 'new_follower'
    : following ? 'follower'
    : 'liked'

  return {
    key: p.key, username: p.username, full_name: p.full_name, profile_pic: p.profile_pic,
    profile_href: p.profile_href, inbox_href: p.inbox_href,
    status,
    from_post: p.from_us.likely ? p.from_us.title : null,
    first_seen: first, last_active: last,
    likes, comments, dmed, following,
    timeline,
  }
}

export type CrmFilter = 'active' | 'all' | 'dmed' | 'new' | 'engaged'

/** "active" = anybody who did something we saw: followed since we started watching, liked, commented, wrote, left */
export function crmFilter(rows: readonly CrmRow[], filter: CrmFilter, search = ''): CrmRow[] {
  const q = search.trim().replace(/^@/, '').toLowerCase()
  return rows.filter(r => {
    if (q && !r.username.toLowerCase().includes(q) && !(r.full_name ?? '').toLowerCase().includes(q)) return false
    if (filter === 'all') return true
    if (filter === 'dmed') return r.dmed
    if (filter === 'new') return r.status !== 'ours' && r.timeline.some(e => e.what === 'Started following')
    if (filter === 'engaged') return r.likes + r.comments > 0 || r.dmed
    return r.timeline.length > 0
  })
}

/** newest activity first; nothing dated last */
export function crmSort(rows: readonly CrmRow[]): CrmRow[] {
  return [...rows].sort((a, b) => {
    if (a.last_active === b.last_active) return a.username.localeCompare(b.username)
    if (a.last_active === null) return 1
    if (b.last_active === null) return -1
    return a.last_active < b.last_active ? 1 : -1
  })
}

export function crmCounts(rows: readonly CrmRow[]): { people: number; new_followers: number; engaged: number; dmed: number; likely_from_posts: number; unfollowed: number } {
  const real = rows.filter(r => r.status !== 'ours')
  return {
    people: real.filter(r => r.timeline.length > 0).length,
    new_followers: real.filter(r => r.timeline.some(e => e.what === 'Started following')).length,
    engaged: real.filter(r => r.likes + r.comments > 0).length,
    dmed: real.filter(r => r.dmed).length,
    likely_from_posts: real.filter(r => r.from_post).length,
    unfollowed: real.filter(r => r.status === 'unfollowed').length,
  }
}

/** the time of day in Melbourne, "9:51 pm" */
export function timeWords(at: string | null | undefined): string | null {
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', minute: '2-digit' }).replace(/\s+/g, ' ').toLowerCase()
}

/** "Today", "Yesterday", or "27 Sep" — against a Melbourne today */
export function dayWords(day: string | null, today: string): string {
  if (!day) return '—'
  if (day === today) return 'Today'
  const t = new Date(`${today}T00:00:00Z`).getTime()
  const d = new Date(`${day}T00:00:00Z`).getTime()
  if (t - d === 86_400_000) return 'Yesterday'
  const dt = new Date(d)
  return `${dt.getUTCDate()} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[dt.getUTCMonth()]}`
}
