/**
 * PAST BRIEFS FROM MILANOTE, ON SHOOTS (the owner, 20 Oct 2026: "shoot briefs in shoots and the others are in boards"
 * … "the board and shoot import"; docs/MILANOTE_MERGE.md). The import put each client's whole Milanote tree on one
 * team board; a shoot brief is a board inside it ("SHOOT 4", "Shoot Brief 6/5", "first shoot 29th AUG"). This finds
 * them — the same board, not a copy — so Shoots can list them and open each one where it is. Pure.
 */
import type { CanvasCard } from './batch-brief-core'

/** a board whose name says it is a shoot's plan */
export function isShootBriefName(name: string | null | undefined): boolean {
  return /\b(shoot|shooy|brief|filming|film\s*day|shot\s*list)\b/i.test(String(name ?? ''))
}

export type PastBrief = {
  /** the team board it lives on */
  teamBoardId: string
  /** the board tile inside it to open — null when the team board itself is the brief */
  boardCardId: string | null
  title: string
  clientId: string | null
  /** where it sits: "Luxe laser › SHOOT 4" */
  path: string
  /** how many cards it holds */
  cards: number
}

type TeamBoardRow = { id: string; name: string; client_id?: string | null; milanote_id?: string | null; canvas_cards?: unknown; archived_at?: string | null }

export function pastBriefs(boards: readonly TeamBoardRow[]): PastBrief[] {
  const out: PastBrief[] = []
  for (const b of boards) {
    if (!b.milanote_id || b.archived_at) continue
    const cards = (Array.isArray(b.canvas_cards) ? b.canvas_cards : []) as CanvasCard[]
    const byId = new Map(cards.map(c => [c.id, c]))
    const inside = (id: string) => cards.filter(c => c.parent === id && c.kind !== 'arrow').length
    const pathOf = (c: CanvasCard) => {
      const names: string[] = []
      for (let p = c.parent; p; p = byId.get(p)?.parent) names.unshift(byId.get(p)?.name ?? 'Board')
      return [b.name, ...names, c.name ?? 'Board'].join(' › ')
    }
    if (isShootBriefName(b.name)) {
      out.push({ teamBoardId: b.id, boardCardId: null, title: b.name, clientId: b.client_id ?? null, path: b.name, cards: cards.filter(c => !c.parent && c.kind !== 'arrow').length })
    }
    for (const c of cards) {
      if (c.kind !== 'board' || !isShootBriefName(c.name)) continue
      out.push({ teamBoardId: b.id, boardCardId: c.id, title: (c.name ?? 'Board').trim(), clientId: b.client_id ?? null, path: pathOf(c), cards: inside(c.id) })
    }
  }
  return out
}

/** the link that opens a brief where it is */
export function pastBriefHref(p: Pick<PastBrief, 'teamBoardId' | 'boardCardId'>): string {
  return `/dashboard/team-boards/${p.teamBoardId}${p.boardCardId ? `?board=${encodeURIComponent(p.boardCardId)}` : ''}`
}

/** the Boards page's filter: every board, the team's own, or those brought over from Milanote */
export type BoardSource = 'all' | 'here' | 'milanote'
export const BOARD_SOURCES: readonly { key: BoardSource; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'here', label: 'Made here' }, { key: 'milanote', label: 'From Milanote' },
]
export function boardFromSource(b: { milanote_id?: string | null }, source: BoardSource): boolean {
  return source === 'all' || (source === 'milanote') === !!b.milanote_id
}
