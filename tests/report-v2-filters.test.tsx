/**
 * REPORT V2 — THE FILTERS (the owner, 5 Nov 2026: "make sure filters work"): every filter changed in turn, on Anthony's
 * real October posts, and the rendered list checked.
 */
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readAccountMonth } from '@/app/lib/report-v2/fetch'
import { normaliseAccount } from '@/app/lib/report-v2/normalise'
import { filterPosts, parseView, typesPresent, viewQuery, type V2View } from '@/app/lib/report-v2/filters'
import type { V2Account, V2Post, ZernioFetch } from '@/app/lib/report-v2/types'
import PostsGrid from '@/app/dashboard/reports/v2/PostsGrid'

const f = JSON.parse(readFileSync('tests/fixtures/zernio/anthony.json', 'utf8')) as { today: string; profileId: string; accounts: V2Account[]; calls: Record<string, unknown> }
const key = (p: string, q: Record<string, unknown>) => `${p}?${Object.keys(q).filter(k => q[k] !== undefined && q[k] !== '').sort().map(k => `${k}=${q[k]}`).join('&')}`
const z = (async (p: string, q: Record<string, string | number | undefined>) => f.calls[key(p, q)]) as ZernioFetch
async function posts(): Promise<V2Post[]> {
  const out: V2Post[] = []
  for (const a of f.accounts) out.push(...normaliseAccount(await readAccountMonth(z, a, f.profileId, '2026-10', f.today)).posts)
  return out
}
const base: Pick<V2View, 'account' | 'type' | 'by' | 'sort'> = { account: 'all', type: 'all', by: 'all', sort: 'views' }
const shownIds = (html: string) => [...html.matchAll(/data-post="([^"]+)"/g)].map(m => m[1])

describe('report v2 filters', () => {
  it('the URL keeps the view, and unknown values fall back', () => {
    const v = parseView(new URLSearchParams('client=c1&month=2026-10&account=instagram&type=reel&by=mdm&sort=date'))
    expect(v).toEqual({ client: 'c1', month: '2026-10', account: 'instagram', type: 'reel', by: 'mdm', sort: 'date' })
    expect(parseView(new URLSearchParams(viewQuery(v)))).toEqual(v)
    expect(parseView(new URLSearchParams('month=2026-13&type=gif&sort=x'))).toMatchObject({ month: null, type: 'all', sort: 'views' })
    expect(viewQuery({ client: 'c1', month: '2026-10', account: 'all', type: 'all', by: 'all', sort: 'views' })).toBe('client=c1&month=2026-10')
  })
  it('account / platform', async () => {
    const all = await posts()
    for (const p of ['instagram', 'facebook', 'tiktok', 'linkedin']) {
      const ids = shownIds(renderToStaticMarkup(<PostsGrid posts={all} view={{ ...base, account: p }} />))
      // nine at a time, then Show more (5 Nov 2026)
      expect(ids.length).toBe(Math.min(9, all.filter(x => x.platform === p).length))
      expect(ids.length).toBeGreaterThan(0)
    }
    const html = renderToStaticMarkup(<PostsGrid posts={all} view={base} />)
    expect(shownIds(html)).toHaveLength(Math.min(9, all.length))
    if (all.length > 9) expect(html).toContain(`Showing 9 of ${all.length} posts`)
  })
  it('type', async () => {
    const all = await posts()
    for (const { type, count } of typesPresent(all)) {
      const shown = filterPosts(all, { ...base, type })
      expect(shown).toHaveLength(count)
      expect(shown.every(p => p.kind === type)).toBe(true)
    }
    expect(renderToStaticMarkup(<PostsGrid posts={all} view={{ ...base, account: 'linkedin', type: 'story' }} />)).toContain('No posts match')
  })
  it('posted by MD Media vs other', async () => {
    const all = await posts()
    const mdm = filterPosts(all, { ...base, by: 'mdm' }), other = filterPosts(all, { ...base, by: 'other' })
    expect(mdm.length + other.length).toBe(all.length)
    expect(mdm.every(p => p.byMdm) && other.every(p => !p.byMdm)).toBe(true)
  })
  it('sort by views / reach / likes / date', async () => {
    const all = await posts()
    const v = (p: V2Post, k: 'views' | 'reach' | 'likes') => p.stats[k].value ?? -1
    for (const k of ['views', 'reach', 'likes'] as const) {
      const s = filterPosts(all, { ...base, sort: k })
      for (let i = 1; i < s.length; i++) expect(v(s[i - 1], k)).toBeGreaterThanOrEqual(v(s[i], k))
    }
    const d = filterPosts(all, { ...base, sort: 'date' })
    for (let i = 1; i < d.length; i++) expect(String(d[i - 1].publishedAt) >= String(d[i].publishedAt)).toBe(true)
  })
  it('Instagram posts show "followed from this post" where > 0', async () => {
    const all = await posts()
    const withFollows = all.filter(p => p.platform === 'instagram' && (p.extras.follows ?? 0) > 0)
    const html = renderToStaticMarkup(<PostsGrid posts={all} view={{ ...base, account: 'instagram' }} />)
    expect((html.match(/followed from this post/g) ?? []).length).toBe(withFollows.length)
  })
})
