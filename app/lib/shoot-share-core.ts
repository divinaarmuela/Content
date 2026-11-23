import { planAsText, type SopShoot } from './shoot-sop-core'
import { sanitiseCanvasCards, type CanvasCard } from './batch-brief-core'
import { canvasCardLabel, findCanvasCard } from './canvas-comments-core'
import { sanitiseScripts, scriptWords } from './script-core'

/**
 * A SHOOT'S LINK FOR THE TEAM, NO SIGN-IN (the owner, 23 Nov 2026: "How to copy this as a link and send to someone?
 * Manal wants this to send to editors as she has made notes on it … we need a public available link for this … this is
 * not a client portal").
 *
 * One link per shoot, minted from the shoot page. It opens a page that anybody holding the link can read: the shoot
 * brief, each script with the comments made on its words, the planning board when there is one, and the rest of the
 * thread. Nothing on it can be changed, nothing on it leads into the dashboard, and switching the link off makes the
 * page go dark. It is NOT the client's portal link: it shows the team's own plan and every comment on it, so it is for
 * editors and crew, and the page says so.
 *
 * Pure: what the page holds, worked out from the shoot's row and its comments. The routes do the reading and writing.
 */

/** a token is 32 hex characters; anything else is not looked up */
export function isShootShareToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
}

export function shootSharePath(token: string): string {
  return `/shoot-plan/${encodeURIComponent(token)}`
}

export type SharedCommentRow = {
  id: string
  body?: string | null
  created_at?: string | null
  parent_id?: string | null
  anchor_part?: string | null
  anchor_quote?: string | null
  card_id?: string | null
  resolved?: boolean | null
  author_name?: string | null
  author_role?: string | null
}

export type SharedComment = {
  id: string
  body: string
  at: string | null
  who: string
  fromClient: boolean
  /** the exact words it was made on, when it was made on words */
  quote: string | null
  resolved: boolean
  replies: { id: string; body: string; at: string | null; who: string; fromClient: boolean }[]
}

export type SharedScript = { key: string; heading: string; lines: string[]; comments: SharedComment[] }

export type SharedShoot = {
  title: string
  client: string | null
  parts: { label: string; value: string }[]
  notes: string | null
  scripts: SharedScript[]
  /** comments on other words of the plan (the objective, a shot, a deliverable), each with what it is on */
  onThePlan: (SharedComment & { on: string })[]
  /** comments pinned to a card of the board, each with the card's name */
  onTheBoard: (SharedComment & { on: string })[]
  /** the rest of the thread */
  general: SharedComment[]
  cards: CanvasCard[]
  commentCount: number
}

const PART_WORDS: Record<string, string> = {
  objective: 'the objective', concept: 'the notes for the team', talent: 'the talent', props_wardrobe: 'props and wardrobe',
  editor_priorities: 'the editor’s priorities', location: 'the location', deliverable: 'a deliverable', shot: 'the shot list', card: 'the board',
}

const nameOf = (c: SharedCommentRow): { who: string; fromClient: boolean } => {
  const fromClient = c.author_role === 'client'
  const raw = String(c.author_name ?? '').replace(/ \(client portal\)$/, '').trim()
  return { who: raw || (fromClient ? 'The client' : 'The team'), fromClient }
}

/** Everything the page shows, from the shoot's row and its comments (oldest first). */
export function sharedShoot(
  batch: SopShoot & { title?: string | null; concept?: string | null; canvas_cards?: unknown; scripts?: unknown },
  clientName: string | null,
  rows: readonly SharedCommentRow[],
): SharedShoot {
  const cards = sanitiseCanvasCards(batch.canvas_cards)
  const sorted = [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  const roots = sorted.filter(c => !c.parent_id)
  const repliesTo = (id: string) => sorted.filter(c => c.parent_id === id).map(r => ({ id: r.id, body: String(r.body ?? ''), at: r.created_at ?? null, ...nameOf(r) }))
  const shape = (c: SharedCommentRow): SharedComment => ({
    id: c.id, body: String(c.body ?? ''), at: c.created_at ?? null, ...nameOf(c),
    quote: c.anchor_quote ? String(c.anchor_quote) : null, resolved: !!c.resolved, replies: repliesTo(c.id),
  })

  const blocks = sanitiseScripts(batch.scripts)
  const words = scriptWords(blocks)
  const scripts: SharedScript[] = blocks.map((b, i) => {
    const key = `script:${b.id}`
    return { key, heading: words[i]?.heading ?? `Script ${i + 1}`, lines: words[i]?.lines ?? [], comments: roots.filter(c => c.anchor_part === key).map(shape) }
  })
  const scriptKeys = new Set(scripts.map(s => s.key))

  const onThePlan = roots
    .filter(c => !!c.anchor_part && !scriptKeys.has(String(c.anchor_part)) && !String(c.anchor_part).startsWith('card:'))
    .map(c => ({ ...shape(c), on: PART_WORDS[String(c.anchor_part).split(':')[0]] ?? 'the plan' }))
  const onTheBoard = roots
    .filter(c => !!c.card_id || String(c.anchor_part ?? '').startsWith('card:'))
    .map(c => {
      const id = c.card_id ?? String(c.anchor_part).slice(5)
      return { ...shape(c), on: canvasCardLabel(findCanvasCard(cards, id)) || 'a card on the board' }
    })
  const general = roots.filter(c => !c.anchor_part && !c.card_id).map(shape)

  const concept = String(batch.concept ?? '').trim()
  return {
    title: String(batch.title ?? '').trim() || 'Shoot plan',
    client: clientName,
    // the scripts are drawn one by one below, each with its comments; the brief's own Script line keeps only the
    // talking points typed straight into it, and goes when there are none
    parts: planAsText(batch).flatMap(p => {
      if (!/^script/i.test(p.label) || scripts.length === 0) return [p]
      const points = String((batch as { script?: unknown }).script ?? '').trim()
      return points ? [{ label: 'Talking points', value: points }] : []
    }),
    notes: concept || null,
    scripts,
    onThePlan, onTheBoard, general,
    cards,
    commentCount: rows.length,
  }
}
