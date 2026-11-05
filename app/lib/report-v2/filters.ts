/**
 * REPORT V2 — THE PAGE'S FILTERS (the owner, 5 Nov 2026: "make sure filters work"). Client, month, account, type of
 * post, who posted it and the sort — all kept in the URL so a link reopens the same view. Pure.
 */
import { isMonthKey } from '../client-report-core'
import { hasValue, type PostKind } from './definitions'
import type { V2Post } from './types'

export type PostType = 'all' | PostKind
export type PostedBy = 'all' | 'mdm' | 'other'
export type PostSort = 'views' | 'reach' | 'likes' | 'date'
export type V2View = { client: string | null; month: string | null; account: string; type: PostType; by: PostedBy; sort: PostSort }

const TYPES: readonly PostType[] = ['all', 'reel', 'carousel', 'image', 'story', 'text']
const BYS: readonly PostedBy[] = ['all', 'mdm', 'other']
const SORTS: readonly PostSort[] = ['views', 'reach', 'likes', 'date']

/** the view from the URL; anything unknown falls back to its default */
export function parseView(q: { get(k: string): string | null }): V2View {
  const pick = <T extends string>(v: string | null, all: readonly T[], d: T): T => (v && (all as readonly string[]).includes(v) ? v as T : d)
  const month = q.get('month')
  return {
    client: q.get('client') || null,
    month: isMonthKey(month) ? month : null,
    account: q.get('account') || 'all',
    type: pick(q.get('type'), TYPES, 'all'),
    by: pick(q.get('by'), BYS, 'all'),
    sort: pick(q.get('sort'), SORTS, 'views'),
  }
}

/** the URL query for a view (defaults left out, so links stay short) */
export function viewQuery(v: V2View): string {
  const q = new URLSearchParams()
  if (v.client) q.set('client', v.client)
  if (v.month) q.set('month', v.month)
  if (v.account !== 'all') q.set('account', v.account)
  if (v.type !== 'all') q.set('type', v.type)
  if (v.by !== 'all') q.set('by', v.by)
  if (v.sort !== 'views') q.set('sort', v.sort)
  return q.toString()
}

const n = (p: V2Post, k: 'views' | 'reach' | 'likes') => (hasValue(p.stats[k]) ? p.stats[k].value! : -1)

/** the posts to show: account ('all' or a platform), type, who posted them, sorted (biggest first; date newest first) */
export function filterPosts(posts: readonly V2Post[], v: Pick<V2View, 'account' | 'type' | 'by' | 'sort'>): V2Post[] {
  const out = posts.filter(p =>
    (v.account === 'all' || p.platform === v.account) &&
    (v.type === 'all' || p.kind === v.type) &&
    (v.by === 'all' || (v.by === 'mdm' ? p.byMdm : !p.byMdm)))
  const byDate = (a: V2Post, b: V2Post) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))
  return out.sort((a, b) => (v.sort === 'date' ? byDate(a, b) : (n(b, v.sort) - n(a, v.sort)) || byDate(a, b)))
}

/** the types of post there are, for the type filter (with counts) */
export function typesPresent(posts: readonly V2Post[]): { type: PostKind; count: number }[] {
  const m = new Map<PostKind, number>()
  for (const p of posts) m.set(p.kind, (m.get(p.kind) ?? 0) + 1)
  return [...m.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count)
}
