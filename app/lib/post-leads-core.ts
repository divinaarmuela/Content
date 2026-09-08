import type { PeopleRow, PeopleAction } from './people-analytics-core'

/**
 * WHO A POST BROUGHT IN — the pure half.
 *
 * Owner, 8 Sep 2026: "one dedicated page, analytics of that post, which
 * cross-checks the inbox of that account, the post that they liked,
 * interacted or commented, and checks if it's a new follower against the
 * existing ones — then it's genuinely an MD Media lead."
 *
 * So for ONE post, every person known to have touched it (the daily read of
 * likers and commenters), joined with the follower list (when they first
 * turned up, whether they have since left) and the Inbox notes (whether they
 * wrote to the account, and when). The join itself is `buildPeople`; this
 * file only answers the question the owner asked of each row.
 *
 * THE VERDICT, in words a person would use:
 *
 *   lead           they touched the post AND first appeared in the follower
 *                  list on or after the day it went out — AND this post is
 *                  the last of ours they touched before following. A new
 *                  follower the post can honestly be credited with.
 *   other_post     a new follower, but they touched a LATER post of ours
 *                  before following — that post gets the credit, not this
 *                  one. Owner: "we only care about new followers from the
 *                  post that they interacted with."'
 *   reached_out    they touched the post and wrote to the account (DM or
 *                  comment seen in the Inbox) on or after that day — but were
 *                  already following, or are not following. Warm, not new.
 *   existing       they follow, and did before the post (or before the first
 *                  follower read — see below). The post reached a fan.
 *   not_following  they touched the post and do not follow. Passing traffic.
 *   left           they followed once and have since gone.
 *
 * Never stronger than the evidence. A follower with no `followed_on` was in
 * the list on the FIRST read, before the app started watching — they count
 * as existing, because nothing says otherwise. The page prints that rule.
 */

export type LeadVerdict = 'lead' | 'other_post' | 'reached_out' | 'existing' | 'not_following' | 'left'

export type LeadRow = {
  person: PeopleRow
  /** what they did on THIS post */
  did: PeopleAction['kind']
  verdict: LeadVerdict
  /** they wrote to the account on or after the post day — true for a lead too */
  reached: boolean
}

export type LeadCounts = Record<LeadVerdict | 'all', number>

const key = (username: string) => username.trim().replace(/^@/, '').toLowerCase()

/** Everyone who touched the post, judged. Order: leads first, then the warm,
 *  then the rest — newest follower first inside each. */
export function leadsForPost(input: {
  rows: readonly PeopleRow[]
  itemId: string
  /** the day the post went out (Melbourne) — null when it never published */
  postDay: string | null
  /** lower-case handles of everybody following TODAY (gone ones excluded) */
  followerKeys: ReadonlySet<string>
}): LeadRow[] {
  const out: LeadRow[] = []
  for (const person of input.rows) {
    const action = person.actions.find(a => a.item_id === input.itemId)
    if (!action) continue
    const following = input.followerKeys.has(key(person.username))
    const reached = !!person.reached_out_on && (!input.postDay || person.reached_out_on >= input.postDay)
    out.push({
      person, did: action.kind, reached,
      verdict: verdictFor({
        person, following, reached, postDay: input.postDay,
        itemId: input.itemId, creditedItemId: creditedPost(person)?.item_id ?? input.itemId,
      }),
    })
  }
  return out.sort(leadOrder)
}

/** the last post of ours they touched on or before the day they followed —
 *  the one the follow is credited to (the same rule as `likelyFromUs`) */
export function creditedPost(person: Pick<PeopleRow, 'followed_on' | 'actions'>): PeopleAction | null {
  if (!person.followed_on) return null
  let best: PeopleAction | null = null
  for (const a of person.actions) {
    if (!a.day || a.day > person.followed_on) continue
    if (!best || a.day > (best.day ?? '')) best = a
  }
  return best
}

export function verdictFor(input: {
  person: Pick<PeopleRow, 'followed_on' | 'gone_on'>
  following: boolean
  reached: boolean
  postDay: string | null
  /** this post, and the post the follow is credited to — omit both to credit this one */
  itemId?: string
  creditedItemId?: string | null
}): LeadVerdict {
  const { person, following, reached, postDay } = input
  if (!following) {
    if (person.gone_on) return 'left'
    return reached ? 'reached_out' : 'not_following'
  }
  if (person.followed_on && postDay && person.followed_on >= postDay) {
    const credited = input.creditedItemId ?? null
    return input.itemId === undefined || credited === null || credited === input.itemId ? 'lead' : 'other_post'
  }
  return reached ? 'reached_out' : 'existing'
}

const RANK: Record<LeadVerdict, number> = { lead: 0, reached_out: 1, other_post: 2, existing: 3, not_following: 4, left: 5 }

export function leadOrder(a: LeadRow, b: LeadRow): number {
  if (RANK[a.verdict] !== RANK[b.verdict]) return RANK[a.verdict] - RANK[b.verdict]
  const fa = a.person.followed_on, fb = b.person.followed_on
  if (fa !== fb) {
    if (fa === null) return 1
    if (fb === null) return -1
    return fa < fb ? 1 : -1
  }
  return a.person.username.localeCompare(b.person.username)
}

export function leadCounts(rows: readonly LeadRow[]): LeadCounts {
  const c: LeadCounts = { all: rows.length, lead: 0, other_post: 0, reached_out: 0, existing: 0, not_following: 0, left: 0 }
  for (const r of rows) c[r.verdict]++
  return c
}

export const VERDICT_WORDS: Record<LeadVerdict, string> = {
  lead: 'New follower — MD Media lead',
  other_post: 'Followed after a later post',
  reached_out: 'Reached out',
  existing: 'Already followed',
  not_following: 'Not following',
  left: 'Unfollowed since',
}

export const VERDICT_SHORT: Record<LeadVerdict, string> = {
  lead: 'Leads',
  other_post: 'Credited elsewhere',
  reached_out: 'Reached out',
  existing: 'Already followed',
  not_following: 'Not following',
  left: 'Unfollowed',
}

/** the one-line explanation of each verdict, for the legend under the table */
export const VERDICT_MEANS: Record<LeadVerdict, string> = {
  lead: 'liked or commented, first appeared in the follower list on or after the day the post went out, and this is the last post of ours they touched before following',
  other_post: 'a new follower who touched this post, but touched a later post of ours before following — that later post gets the credit, not this one',
  reached_out: 'liked or commented and wrote to the account (a DM or a comment seen in the Inbox) since the post — but was already following, or is not following',
  existing: 'was already following before the post went out — or was in the list on the first follower read, before the app started watching',
  not_following: 'liked or commented but does not follow the account',
  left: 'followed once and has since unfollowed',
}

/** the sentence at the top: what the post brought in, said plainly */
export function leadsSummary(counts: LeadCounts, postDay: string | null): string {
  if (!postDay) return 'This post has not gone out yet, so nobody can have followed from it.'
  if (counts.all === 0) return 'Nobody has been read for this post yet — press "Read who liked now".'
  const lead = counts.lead === 1 ? '1 new follower' : `${counts.lead} new followers`
  const warm = counts.reached_out === 0 ? '' : `, ${counts.reached_out} reached out`
  return `${counts.all} ${counts.all === 1 ? 'person' : 'people'} touched this post: ${lead} it can be credited with${warm}, ${counts.existing} already following, ${counts.not_following} not following.`
}

export function leadsCsv(rows: readonly LeadRow[]): string {
  const esc = (v: string | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = ['Handle,Name,Did,Followed on,Reached out on,How,Verdict']
  for (const r of rows) {
    lines.push([
      esc(r.person.username), esc(r.person.full_name), esc(r.did),
      esc(r.person.followed_on), esc(r.person.reached_out_on), esc(r.person.reached_out_how),
      esc(VERDICT_WORDS[r.verdict]),
    ].join(','))
  }
  return lines.join('\n') + '\n'
}
