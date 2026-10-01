/**
 * WHO A PERSON IN THE INBOX IS (the owner, 28–30 Sep 2026): for the clients below, each person's trip through the
 * comment-to-DM automations — what they commented, whether the DM went, whether they read it, their taps on its
 * button — read from Zernio's per-person automation log. The Inbox's "About this person" card shows it.
 *
 * (Until 1 Oct 2026 this also joined a third-party read of followers and of who liked a post — the People page. That
 * read, and the page, were removed; only the Zernio side is here.)
 */
import { inboxPersonHref, instagramProfileHref } from './inbox-people-core'

/**
 * The clients this covers (the owner, 28 Sep 2026: "only for Justin and Jordan"). Add an id to open it to
 * another client — everything below works for any client with Instagram connected.
 */
export const PEOPLE_CRM_CLIENTS: readonly { id: string; name: string }[] = [
  { id: '2e27f9e4-9cb5-43a6-a06b-f317f207a1e8', name: 'Justin Engelke' },
  { id: 'eb550318-b5a4-4dd6-81ea-9310588a55bb', name: 'Jordan Wilson' },
  // the test client, so the page is checked on test data and never on a real client's (30 Sep 2026)
  { id: '459e2564-1089-45ed-abd7-56d5f53c2cf6', name: '100 Hundred Million Group (test)' },
]

export type CrmEvent = {
  /** what happened, as a person says it */
  what: string
  /** the post, or the note beside it */
  detail: string | null
  /** YYYY-MM-DD */
  day: string
  /** the exact instant, when the provider gave one (a comment, a DM) — a time is shown beside the day */
  at?: string | null
  /** where the detail opens — the Inbox on this person */
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
  status: 'commented'
  first_seen: string | null
  last_active: string | null
  /** comment-to-DM automations: DMs it sent this person, and taps on its button (Zernio's per-person log) */
  auto_dms: number
  auto_clicks: number
  /** newest first */
  timeline: CrmEvent[]
}

const max = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b)
const min = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b)

/** newest activity first; nothing dated last */
export function crmSort(rows: readonly CrmRow[]): CrmRow[] {
  return [...rows].sort((a, b) => {
    if (a.last_active === b.last_active) return a.username.localeCompare(b.username)
    if (a.last_active === null) return 1
    if (b.last_active === null) return -1
    return a.last_active < b.last_active ? 1 : -1
  })
}

/* ── comment-to-DM automations, per person (the owner, 29–30 Sep 2026: "tracking data in the followers page for
 *    Justin and Jordan — which trigger, clicked, opened, read"; "there is no CRM part for the automation data") ── */

/**
 * One commenter's trip through an automation, as Zernio logs it: what they commented and when, whether the DM went
 * (or why not), and their taps on its button — and whether they read it, which the log does not say but the DM
 * itself does (`deliveryStatus: 'read'`, `readAt`; read off the conversation, 30 Sep 2026).
 */
export type AutomationTouch = {
  /** Instagram's id for the commenter — on Instagram also the id of the DM conversation with them */
  commenter_id: string | null
  account_id: string
  /** when they opened the DM, from the DM itself (Zernio's message deliveryStatus), when it was read */
  read_at: string | null
  username: string
  comment: string
  at: string
  outcome: 'sent' | 'failed' | 'skipped'
  why: string | null
  clicked_at: string | null
  clicks: number
  post: string | null
  keyword: string | null
}

/** every automation line in a timeline starts with this, so the filter and the page can find them */
export const AUTO_PREFIX = 'Automation: '

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** Zernio's automations on these accounts + each one's logs → one touch per logged comment. */
export function readAutomationTouches(
  automations: unknown, logsById: Readonly<Record<string, unknown>>, accountIds: ReadonlySet<string>,
): AutomationTouch[] {
  const list = Array.isArray((automations as { automations?: unknown })?.automations)
    ? (automations as { automations: Record<string, unknown>[] }).automations : []
  const out: AutomationTouch[] = []
  for (const a of list) {
    const id = str(a.id)
    if (!id || !accountIds.has(String(a.accountId ?? ''))) continue
    const logs = (logsById[id] as { logs?: Record<string, unknown>[] } | undefined)?.logs ?? []
    const keywords = Array.isArray(a.keywords) ? a.keywords.map(String) : []
    for (const l of logs) {
      const username = str(l.commenterName)
      const at = str(l.createdAt)
      if (!username || !at) continue
      const status = String(l.status ?? '')
      out.push({
        commenter_id: str(l.commenterId),
        account_id: String(a.accountId ?? ''),
        read_at: null,
        username: username.replace(/^@/, ''),
        comment: String(l.commentText ?? ''),
        at,
        outcome: status === 'sent' ? 'sent' : status === 'skipped' ? 'skipped' : 'failed',
        why: str(l.error),
        clicked_at: str(l.clickedAt),
        clicks: typeof l.clickCount === 'number' ? l.clickCount : 0,
        post: str(a.postTitle),
        keyword: keywords[0] ?? null,
      })
    }
  }
  return out
}

const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' })

/**
 * The automation touches laid onto the CRM: each commenter's row gets the comment, the DM (or why it did not go) and
 * the button taps on its timeline, and counts of both. A commenter the other reads have not seen yet gets a row of
 * their own — they commented on the client's post, which is a touch.
 */
export function withAutomationTouches(rows: readonly CrmRow[], touches: readonly AutomationTouch[]): CrmRow[] {
  const byKey = new Map(rows.map(r => [r.key, { ...r, timeline: [...r.timeline] }]))
  for (const t of touches) {
    const k = t.username.toLowerCase()
    let r = byKey.get(k)
    if (!r) {
      r = {
        key: k, username: t.username, full_name: null, profile_pic: null,
        profile_href: instagramProfileHref(t.username), inbox_href: inboxPersonHref(t.username),
        status: 'commented', first_seen: null, last_active: null,
        auto_dms: 0, auto_clicks: 0, timeline: [],
      }
      byKey.set(k, r)
    }
    const on = t.post ? `on ‘${t.post}’` : null
    // the DM answers the comment: a millisecond after it, so newest-first never shows the reply above what it answers
    const after = new Date(Date.parse(t.at) + 1).toISOString()
    r.timeline.push({ what: `${AUTO_PREFIX}commented “${t.comment}”`, detail: on, day: dayOf(t.at), at: t.at, href: null, link: null, tone: 'strong' })
    if (t.outcome === 'sent') {
      r.auto_dms++
      r.timeline.push({ what: `${AUTO_PREFIX}DM sent`, detail: t.keyword ? `keyword ${t.keyword}` : null, day: dayOf(t.at), at: after, href: r.inbox_href, link: 'View DM', tone: 'strong' })
    } else {
      r.timeline.push({ what: `${AUTO_PREFIX}${t.outcome === 'skipped' ? 'no DM' : 'DM failed'}`, detail: t.why, day: dayOf(t.at), at: after, href: null, link: null, tone: t.outcome === 'skipped' ? 'plain' : 'lost' })
    }
    if (t.outcome === 'sent' && t.read_at) {
      r.timeline.push({ what: `${AUTO_PREFIX}read the DM`, detail: null, day: dayOf(t.read_at), at: t.read_at, href: null, link: null, tone: 'plain' })
    }
    if (t.clicks > 0 && t.clicked_at) {
      r.auto_clicks += t.clicks
      r.timeline.push({ what: `${AUTO_PREFIX}clicked the button${t.clicks > 1 ? ` ×${t.clicks}` : ''}`, detail: t.clicks > 1 ? 'first click shown' : null, day: dayOf(t.clicked_at), at: t.clicked_at, href: null, link: null, tone: 'strong' })
    }
  }
  const out = [...byKey.values()]
  for (const r of out) {
    r.timeline.sort((a, b) => (a.day === b.day ? String(b.at ?? '').localeCompare(String(a.at ?? '')) : a.day < b.day ? 1 : -1))
    const days = r.timeline.map(e => e.day)
    r.first_seen = days.reduce<string | null>((m, d) => min(m, d), r.first_seen)
    r.last_active = days.reduce<string | null>((m, d) => max(m, d), r.last_active)
  }
  return out
}

/** When they read the automation's DM, from the conversation's messages: the automation's own message nearest after
 *  their comment. Null when it was not read, or the messages do not say. */
export function readAtFromThread(messages: unknown, commentAt: string): string | null {
  const r = messages as { messages?: unknown; data?: unknown } | null
  const list = (Array.isArray(r?.messages) ? r.messages : Array.isArray(r?.data) ? r.data : Array.isArray(messages) ? messages : []) as Record<string, unknown>[]
  const from = Date.parse(commentAt)
  const ours = list
    .filter(m => (m.sentVia === 'comment_automation' || (m.metadata as { sentVia?: string } | undefined)?.sentVia === 'comment_automation'))
    .filter(m => Date.parse(String(m.createdAt ?? m.sentAt ?? '')) >= from - 60_000)
    .sort((x, y) => Date.parse(String(x.createdAt ?? '')) - Date.parse(String(y.createdAt ?? '')))
  const hit = ours[0]
  if (!hit || hit.deliveryStatus !== 'read') return null
  return str(hit.readAt) ?? str(hit.createdAt)
}
