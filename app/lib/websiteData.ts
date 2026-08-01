import { supabase } from '@/lib/supabase'
import { clients as fallbackClients, wixImg, type WorkClient } from '../components/lama/workData'

/** Canonical shape the site renders. DB rows and the hardcoded fallback both
 *  map into this. Media URLs may be images or videos — use isVideoUrl(). */
export type SiteProject = {
  id: string | null // null = from the hardcoded fallback
  slug: string
  name: string
  industry: string
  tag: string
  services: string[]
  desc: string
  cardMedia: string
  heroMedia: string
  result?: string | null
  study: { challenge: string[]; approach: string[]; outcome: string[] }
}

export const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url)

const fromFallback = (c: WorkClient): SiteProject => ({
  id: null,
  slug: c.slug,
  name: c.name,
  industry: c.industry,
  tag: c.tag,
  services: c.services,
  desc: c.desc,
  cardMedia: wixImg(c.img, 1000, 800),
  heroMedia: wixImg(c.img, 1600, 800),
  result: c.result ?? null,
  study: c.study,
})

type ProjectRow = {
  id: string
  slug: string
  name: string
  industry: string
  tag: string
  services: string[]
  description: string
  card_media_url: string
  hero_media_url: string
  result: string | null
  challenge: string[]
  approach: string[]
  outcome: string[]
}

const fromRow = (r: ProjectRow): SiteProject => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  industry: r.industry,
  tag: r.tag,
  services: r.services ?? [],
  desc: r.description,
  cardMedia: r.card_media_url,
  heroMedia: r.hero_media_url || r.card_media_url,
  result: r.result,
  study: {
    challenge: r.challenge ?? [],
    approach: r.approach ?? [],
    outcome: r.outcome ?? [],
  },
})

const dbConfigured = () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)

/** Published projects for the public site, sorted. Falls back to the
 *  hardcoded list whenever the DB is unconfigured, unreachable, or empty —
 *  the site never renders blank because of the CMS. */
export async function getSiteProjects(): Promise<SiteProject[]> {
  if (!dbConfigured()) return fallbackClients.map(fromFallback)
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('published', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (error || !data || data.length === 0) return fallbackClients.map(fromFallback)
    return (data as ProjectRow[]).map(fromRow)
  } catch {
    return fallbackClients.map(fromFallback)
  }
}

export async function getSiteProject(slug: string): Promise<SiteProject | null> {
  const all = await getSiteProjects()
  return all.find(p => p.slug === slug) ?? null
}
