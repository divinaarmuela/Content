/**
 * THE MILANOTE IMPORT (the owner, 20 Oct 2026; docs/MILANOTE_MERGE.md). Run with jiti so it shares the app's own code:
 *
 *   npx jiti scripts/import-milanote.ts <snapshot.json>            # dry run: what it would make, per board
 *   npx jiti scripts/import-milanote.ts <snapshot.json> --write    # make it
 *
 * One team board per Milanote client board (its whole tree inside, Milanote's places and sizes), each board's own
 * home boards too, and an "MD Media" board that rebuilds Milanote's MD Media page with board links to the clients'.
 * A client not here yet is made as an archived (past) client — nothing sent, nothing set up. Every card keeps its
 * Milanote id, so a re-run finds what it made; a board already imported is left alone unless --again is given.
 * Milanote itself is only read (from the saved snapshot). Comments come over as comments on the nearest card.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { sanitiseCanvasCards, type CanvasCard } from '../app/lib/batch-brief-core'
import { convertTree, kidsIndex, nearestCard, sameClient, type MnElement } from '../app/lib/milanote-import-core'
import { htmlText, milanoteToHtml } from '../app/lib/canvas-rich-core'

const args = process.argv.slice(2)
const snapPath = args.find(a => !a.startsWith('--'))
const WRITE = args.includes('--write')
const AGAIN = args.includes('--again')
if (!snapPath) { console.error('Usage: npx jiti scripts/import-milanote.ts <snapshot.json> [--write] [--again]'); process.exit(1) }

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')] }))
const DB = String(env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')
if (!DB) { console.error('Missing NEXT_PUBLIC_FIREBASE_DATABASE_URL in .env.local'); process.exit(1) }
const dbGet = async (t: string) => (await (await fetch(`${DB}/mdm/tables/${t}.json`)).json()) ?? {}
const dbPut = async (t: string, id: string, v: unknown) => {
  const r = await fetch(`${DB}/mdm/tables/${t}/${id}.json`, { method: 'PUT', body: JSON.stringify(v) })
  if (!r.ok) throw new Error(`write ${t}/${id}: ${r.status} ${await r.text()}`)
}

/* ── what Milanote holds ── */
const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as {
  takenAt: string; home: string; mdMedia: string
  elements: Record<string, MnElement>
  comments?: Record<string, { threadId: string; userId: string; text: unknown; createdAt: number }>
  users?: { users?: Record<string, { name?: { displayName?: string } }> }
}
const E = snap.elements
const kids = kidsIndex(E)
const title = (id: string) => String((E[id]?.content as { title?: string } | undefined)?.title ?? '').replace(/\s+/g, ' ').trim()

// the client boards: the two client columns on MD Media's page
const CLIENT_COLUMNS = ['1UboZI1qT2FH5I', '1Vdchl1Pgcnn0s']
// boards on Milanote's home page, each its own team board, and whose client they are
const HOME_BOARDS: Record<string, string> = {
  '1Ua5by1XPUDQcK': 'Atelier Realty',
  '1UbNZj13vt025B': 'Seachange',
  '1UcxO01A5liIaQ': 'Jason Swift',
  '1Ufvu11j8pnaf9': 'Rollie',
  // boards shared into this account from Cecconi's and a newer MD Media board, linked from Milanote's home page
  '1Uf3kE1fnnhMfe': "Cecconi's",
  '1Uf4gV1fnnhMgp': "Cecconi's",
  '1XdSDh1ypEbN67': 'MD Media',
}
type Plan = { boardId: string; name: string; client: string }
const plans: Plan[] = []
for (const col of CLIENT_COLUMNS) {
  for (const e of [...(kids.get(col) ?? [])]) {
    if (e.elementType !== 'BOARD') continue
    plans.push({ boardId: e._id, name: title(e._id), client: title(e._id) })
  }
}
for (const [id, client] of Object.entries(HOME_BOARDS)) plans.push({ boardId: id, name: title(id), client })
// the hub: MD Media's own page, its client boards as links
plans.push({ boardId: snap.mdMedia, name: 'MD Media (from Milanote)', client: 'MD Media' })

/** a Milanote board's own colour and icon (or cover) */
const boardLook = (id: string): { hex?: string; icon_url?: string } => {
  const c = (E[id]?.content ?? {}) as { color?: unknown; icon?: { png?: string } | null; image?: { regular?: string } }
  const hex = typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color) ? c.color.toLowerCase() : undefined
  const url = c.image?.regular ?? c.icon?.png
  return { ...(hex ? { hex } : {}), ...(typeof url === 'string' && url.startsWith('https://') ? { icon_url: url } : {}) }
}

/** the owner (Akmal Ashwin, super admin) — who the import's quality check and sharing are recorded as */
const OWNER_ID = '01450dc3-0393-4d7c-906a-ff4c8851cf27'

/* ── what we hold ── */
const main = async () => {
  const [clientsObj, boardsObj, mediaObj, teamObj] = await Promise.all([dbGet('clients'), dbGet('team_boards'), dbGet('milanote_media'), dbGet('team_users')])
  const clients = Object.values(clientsObj) as { id: string; name: string; status?: string }[]
  const existing = Object.values(boardsObj) as { id: string; milanote_id?: string | null; name: string }[]
  const media = new Map<string, string>()
  for (const r of Object.values(mediaObj) as { id: string; url?: string | null; status: string }[]) if (r.status === 'done' && r.url) media.set(r.id, r.url)
  const team = Object.values(teamObj) as { id: string; name?: string | null }[]

  // the team board each Milanote board becomes — reused when an earlier run made it
  const boardTarget = new Map<string, string>()
  for (const p of plans) {
    const had = existing.find(b => b.milanote_id === p.boardId)
    boardTarget.set(p.boardId, had?.id ?? randomUUID())
  }
  // the client each board is for: one we have (loosely matched), or a past client to make
  const clientFor = new Map<string, { id: string; name: string; isNew: boolean }>()
  const made = new Map<string, { id: string; name: string; isNew: boolean }>()
  for (const p of plans) {
    const have = clients.find(c => sameClient(c.name, p.client))
    if (have) { clientFor.set(p.boardId, { id: have.id, name: have.name, isNew: false }); continue }
    const key = p.client.toLowerCase().replace(/[^a-z0-9]/g, '')
    const m = made.get(key) ?? { id: randomUUID(), name: p.client.replace(/\b\w/g, ch => ch.toUpperCase()).replace(/\B\w+/g, w => w === w.toUpperCase() && w.length > 1 ? w.toLowerCase() : w), isNew: true }
    made.set(key, m)
    clientFor.set(p.boardId, m)
  }

  const userName = (uid: string) => snap.users?.users?.[uid]?.name?.displayName ?? 'Someone'
  let totalCards = 0, totalComments = 0
  const rows: { plan: Plan; id: string; cards: CanvasCard[]; skip: boolean; comments: unknown[] }[] = []
  console.log(`Milanote snapshot ${snap.takenAt} — ${Object.keys(E).length} items, ${plans.length} boards to make\n`)
  for (const p of plans) {
    // inside its own board, every OTHER planned board is a link to it, not a copy
    const targets = new Map([...boardTarget].filter(([mn]) => mn !== p.boardId))
    const res = convertTree(p.boardId, { elements: E, kids, media, boardTarget: targets })
    const clean = sanitiseCanvasCards(res.cards)
    const lost = res.cards.length - clean.length
    const id = boardTarget.get(p.boardId)!
    const had = existing.find(b => b.milanote_id === p.boardId)
    const skip = !!had && !AGAIN
    // comments on the nearest card
    const comments = res.threads.flatMap(th => Object.entries(snap.comments ?? {}).filter(([, c]) => c.threadId === th.threadId).map(([key, c]) => {
      const who = userName(c.userId)
      const author = team.find(u => (u.name ?? '').trim().toLowerCase() === who.toLowerCase())
      return {
        // the Milanote comment's own id: a re-run writes the same row, never a second one
        id: `mn_${key}`.replace(/[.#$[\]/]/g, '_'), board_id: id, card_id: th.card && clean.some(k => k.id === th.card) ? th.card : nearestCard(clean, th.board, th.x, th.y),
        author_id: author?.id ?? null,
        body: `${author ? '' : `${who} (in Milanote): `}${htmlText(milanoteToHtml(c.text)).trim()}`,
        assigned_to: null, resolved: false, created_at: new Date(c.createdAt).toISOString(),
      }
    }))
    totalCards += clean.length; totalComments += comments.length
    const kinds = Object.entries(res.made).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')
    const c = clientFor.get(p.boardId)!
    console.log(`${skip ? 'ALREADY THERE ' : ''}${p.name} → client ${c.name}${c.isNew ? ' (new, archived)' : ''}`)
    console.log(`   ${clean.length} cards${lost ? ` (${lost} refused by the board's checker!)` : ''}: ${kinds}`)
    if (res.skipped.length) console.log(`   not brought: ${Object.entries(res.skipped.reduce((a, s) => ({ ...a, [s.why]: (a[s.why as keyof typeof a] ?? 0) + 1 }), {} as Record<string, number>)).map(([w, n]) => `${n} × ${w}`).join(', ')}`)
    if (comments.length) console.log(`   ${comments.length} comment(s)`)
    if (clean.length > 1500) console.log('   !! over the board\'s 1,500-card limit')
    rows.push({ plan: p, id, cards: clean, skip, comments })
  }
  const newClients = [...made.values()]
  console.log(`\n${totalCards} cards on ${plans.length} boards, ${totalComments} comments; ${newClients.length} past clients to make: ${newClients.map(c => c.name).join(', ')}`)
  const missingMedia = Object.values(E).filter(e => e.elementType === 'IMAGE' && !media.has(`${e._id}_image`)).length
  console.log(`${missingMedia} image(s) still on Milanote's own address (not copied yet)`)

  if (!WRITE) { console.log('\nDry run — nothing written. Add --write to make it.'); return }

  const now = new Date().toISOString()
  for (const c of newClients) {
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    await dbPut('clients', c.id, { id: c.id, name: c.name, slug: `${slug}-milanote`, status: 'archived', notes: 'A past client, brought over from Milanote (20 Oct 2026).', created_at: now })
  }
  for (const r of rows) {
    if (r.skip) continue
    const c = clientFor.get(r.plan.boardId)!
    await dbPut('team_boards', r.id, {
      // a finished board from Milanote is Approved, not a new Inspo (the owner, 20 Oct 2026: "since this boards have
      // been created why is it in draft"); its own colour and icon go on its tile
      id: r.id, name: r.plan.name, client_id: c.id, status: 'approved', canvas_cards: r.cards, ...boardLook(r.plan.boardId),
      // passed the quality check, and on the client's portal (the owner, 20 Oct 2026: "mark it as passed quality
      // review … and make sure its on their portal") — stamped as the owner's own; sharing this way emails nobody
      reviewed_by: OWNER_ID, reviewed_at: now, review_note: null,
      shared_with_client: true, client_shared_at: now, client_shared_by: OWNER_ID,
      board_type: 'other', milanote_id: r.plan.boardId,
      created_by: null, updated_by: null, created_at: now, updated_at: now,
    })
    for (const cm of r.comments) await dbPut('team_board_comments', (cm as { id: string }).id, cm)
  }
  console.log(`\nWritten: ${rows.filter(r => !r.skip).length} boards, ${newClients.length} clients.`)
}
main().catch(e => { console.error(e); process.exit(1) })
