/**
 * THE IMPORTED BOARDS' ICONS, FROM OUR COPIES (20 Oct 2026). Every board and board tile whose icon still loads from
 * static.milanote.com is pointed at its copy in public/board-icons/milanote/ (app/lib/board-icons-core.ts).
 *
 *   npx jiti scripts/local-board-icons.ts            # dry run: what would change
 *   npx jiti scripts/local-board-icons.ts --write    # change it
 *
 * Each board is written with its ETag (if-match), so a board someone saved in between is skipped, not overwritten.
 */
import { readFileSync } from 'node:fs'
import { localIconUrl } from '../app/lib/board-icons-core'

const WRITE = process.argv.includes('--write')
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const DB = String(env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
if (!DB) { console.error('Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL'); process.exit(1) }

type Card = { icon_url?: string } & Record<string, unknown>
const main = async () => {
  const boards = Object.values((await (await fetch(`${DB}/mdm/tables/team_boards.json?shallow=false`)).json()) ?? {}) as { id: string; name: string; icon_url?: string; canvas_cards?: Card[] }[]
  let boardsChanged = 0, tiles = 0, own = 0, skipped = 0
  for (const b of boards) {
    const res = await fetch(`${DB}/mdm/tables/team_boards/${b.id}.json`, { headers: { 'X-Firebase-ETag': 'true' } })
    const etag = res.headers.get('etag')
    const row = await res.json() as typeof b | null
    if (!row || !etag) continue
    let changed = false
    const cards = (row.canvas_cards ?? []).map(c => {
      if (typeof c?.icon_url !== 'string') return c
      const next = localIconUrl(c.icon_url)
      if (next === c.icon_url) return c
      changed = true; tiles++
      return { ...c, icon_url: next }
    })
    const ownNext = typeof row.icon_url === 'string' ? localIconUrl(row.icon_url) : row.icon_url
    if (ownNext !== row.icon_url) { changed = true; own++ }
    if (!changed) continue
    boardsChanged++
    if (!WRITE) continue
    const put = await fetch(`${DB}/mdm/tables/team_boards/${b.id}.json`, {
      method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify({ ...row, canvas_cards: cards, ...(ownNext ? { icon_url: ownNext } : {}) }),
    })
    if (put.status === 412) { skipped++; console.log(`  ${row.name}: changed by someone just now — skipped, run again`) }
    else if (!put.ok) throw new Error(`${row.name}: ${put.status} ${await put.text()}`)
  }
  console.log(`${boardsChanged} boards: ${tiles} tile icons and ${own} board icons ${WRITE ? 'now from our copies' : 'would move to our copies'}${skipped ? `; ${skipped} skipped` : ''}`)
  if (!WRITE) console.log('Dry run — add --write.')
}
main().catch(e => { console.error(e); process.exit(1) })
