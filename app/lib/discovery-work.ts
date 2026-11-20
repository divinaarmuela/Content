import { SECTORS, type SectorClient } from '../work/sectors'

/**
 * A SNEAK PEEK OF OUR WORK, AT THE END OF THE DISCOVERY FORM (Abby, via the owner, 20 Nov 2026: "add what business
 * industry you are in and then at the last page … a sneak peek of brands we did like the work page … depends on which
 * industry they are and we can show the same industry as them so they get inspo").
 *
 * The form asks their industry from the Work page's own sectors; when it is sent in, the thank-you screen shows a few
 * of the brands in that sector. Nothing is invented: every brand, picture and link here is read from the Work page's
 * list (app/work/sectors.ts), so the form can never show a client the site does not. Pure.
 */

/** the industries the form offers: the Work page's sectors, in its order */
export const DISCOVERY_INDUSTRIES: string[] = SECTORS.map(s => s.name)

/** `image` is the still (a loop's poster); `video` is the loop itself when the brand has one */
export type WorkTile = { name: string; sector: string; image: string; video: string | null; href: string }

/**
 * THE OWNER'S PICKS FOR THIS SHELF (20 Nov 2026, of the live thank-you screen: "remove real deal, it's an ugly photo,
 * use senorita"). Real Deal Property stays on the Work page; it is only left off this shelf. Senorita leads wherever
 * she is on it, so she is the large tile unless their own industry's brands come first.
 */
const LEFT_OFF = new Set(['Real Deal Property'])
const LEADS = 'Senorita Debutante Dresses'
const leadFirst = (list: WorkTile[]): WorkTile[] => [...list.filter(t => t.name === LEADS), ...list.filter(t => t.name !== LEADS)]

const tileOf = (c: SectorClient, sector: string): WorkTile | null => {
  // a loop is `x.mp4` beside its poster `x.jpg`
  const image = c.media?.image ?? (c.media?.video ? `${c.media.video}.jpg` : null)
  // a brand with no picture is not shown: an empty frame is no inspiration
  if (!image || LEFT_OFF.has(c.name)) return null
  return { name: c.name, sector, image, video: c.media?.video ? `${c.media.video}.mp4` : null, href: c.slug ? `/work/${c.slug}` : '/work' }
}

const tiles = (sector: (typeof SECTORS)[number]): WorkTile[] =>
  sector.clients.flatMap(c => { const t = tileOf(c, sector.name); return t ? [t] : [] })

/** one from each sector, then a second from each, and so on: a spread of the whole Work page */
function spread(skip: string | null): WorkTile[] {
  const rows = SECTORS.filter(s => s.name !== skip).map(tiles)
  const out: WorkTile[] = []
  for (let i = 0; rows.some(r => i < r.length); i++) for (const r of rows) if (r[i]) out.push(r[i])
  return leadFirst(out)
}

/**
 * WHAT TO SHOW: always a full shelf of `max` (the owner, 20 Nov 2026: "show the ones we have of work page … list it
 * nicely"; a sector with one picture looked half empty). Their own industry's brands come first; what is left of the
 * shelf is filled from the other sectors. `matched` is their sector when at least one tile is from it, and `mixed`
 * says whether other sectors are on the shelf too, so the heading can be honest about it.
 */
export function workPeek(industry: string | null | undefined, max = 5): { matched: string | null; mixed: boolean; tiles: WorkTile[] } {
  const want = String(industry ?? '').trim().toLowerCase()
  const sector = SECTORS.find(s => s.name.toLowerCase() === want)
  const own = sector ? leadFirst(tiles(sector)).slice(0, max) : []
  const rest = spread(own.length ? sector!.name : null).slice(0, max - own.length)
  return { matched: own.length ? sector!.name : null, mixed: rest.length > 0, tiles: [...own, ...rest] }
}
