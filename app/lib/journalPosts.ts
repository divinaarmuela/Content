import { table } from '@/lib/db'
import type { JournalPost as JournalPostRow } from '@/lib/db-types'
import { articles as fallbackArticles, type Article } from '../journal/journalData'

/**
 * Journal posts from the CMS, falling back to the hardcoded articles.
 *
 * Same posture as websiteData: an empty table or an unreachable database
 * renders the shipped articles rather than an empty Journal. Losing the
 * database should degrade the site, not blank it.
 */

export type JournalSection = {
  heading?: string
  paragraphs: string[]
  callout?: string
}

export type JournalPost = {
  id: string | null // null = from the hardcoded fallback
  slug: string
  title: string
  standfirst: string
  category: string
  coverUrl: string
  readMins: number
  /** ISO date, for ordering. Null on fallback articles, which only carry a label. */
  publishedAt: string | null
  /** what the page prints, e.g. "July 2026" */
  dateLabel: string
  featured: boolean
  sections: JournalSection[]
}

type PostRow = {
  id: string
  slug: string
  title: string
  standfirst: string
  category: string
  cover_url: string
  read_mins: number
  published_at: string | null
  featured: boolean
  sections: JournalSection[] | null
}

function dbConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL)
}

/** "2026-07-14" → "July 2026". Month and year only: these are essays, not news. */
export function formatPostDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const fromRow = (r: PostRow): JournalPost => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  standfirst: r.standfirst ?? '',
  category: r.category ?? '',
  coverUrl: r.cover_url ?? '',
  readMins: r.read_mins ?? 3,
  publishedAt: r.published_at,
  dateLabel: formatPostDate(r.published_at),
  featured: !!r.featured,
  sections: Array.isArray(r.sections) ? r.sections : [],
})

const fromFallback = (a: Article): JournalPost => ({
  id: null,
  slug: a.slug,
  title: a.title,
  standfirst: a.standfirst,
  // the shipped articles predate the category field; the rail treats an empty
  // category as untagged rather than inventing one
  category: '',
  coverUrl: '',
  readMins: a.readMins,
  publishedAt: null,
  dateLabel: a.date,
  featured: !!a.featured,
  sections: a.sections,
})

export async function getJournalPosts(): Promise<JournalPost[]> {
  if (!dbConfigured()) return fallbackArticles.map(fromFallback)
  try {
    const rows = await table<JournalPostRow>('journal_posts').list({
      by: { published: true },
      orderBy: [['published_at', 'desc'], ['sort_order', 'asc']],
    })
    if (rows.length === 0) return fallbackArticles.map(fromFallback)
    return (rows as unknown as PostRow[]).map(fromRow)
  } catch {
    return fallbackArticles.map(fromFallback)
  }
}

export async function getJournalPost(slug: string): Promise<JournalPost | null> {
  const all = await getJournalPosts()
  return all.find(p => p.slug === slug) ?? null
}

/** Distinct categories across the posts, for the topic rail. Untagged posts
 *  contribute nothing rather than an empty chip. */
export function collectCategories(posts: JournalPost[]): string[] {
  const seen = new Map<string, string>()
  for (const p of posts) {
    const label = p.category.trim()
    if (!label) continue
    const key = label.toLowerCase()
    if (!seen.has(key)) seen.set(key, label)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
