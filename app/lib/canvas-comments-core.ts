/**
 * Comments pinned to ONE card of a shoot's planning board — the pure half.
 *
 * A shoot comment row may carry a `card_id`: the card on the canvas it is
 * about. Null is the shoot's general thread. Everything both sides of the
 * glass need to say WHICH card — the label on the card, the badge count, the
 * "on: Hero reel image" prefix in the thread, the subject of the manager's
 * email, the link that opens the shoot page on that card — is decided here,
 * so the portal and the team's page agree by construction.
 */

import type { CanvasCard } from './batch-brief-core'

/** The words a person would use to say which card this is. Never a raw
 *  kind name, never an id: "Hero reel image", not "image:abc123". */
export function canvasCardLabel(card: Pick<CanvasCard, 'kind' | 'name' | 'text' | 'url' | 'platform'> | null | undefined): string {
  if (!card) return 'a card that has since been removed'
  const name = (card.name ?? '').trim()
  const firstLine = (card.text ?? '').trim().split('\n')[0]?.trim() ?? ''
  const short = (s: string) => (s.length > 48 ? `${s.slice(0, 47)}…` : s)
  switch (card.kind) {
    case 'note': return short(firstLine) || 'Note'
    case 'label': return short(firstLine) || 'Heading'
    case 'todo': return name ? `${short(name)} (to-do list)` : 'To-do list'
    case 'board': return name ? `${short(name)} (board)` : 'Board'
    case 'image': return name ? short(name) : 'Image'
    case 'mockup': return name ? `${short(name)} (post mock-up)` : 'Post mock-up'
    case 'link': {
      if (name) return short(name)
      try { return new URL(card.url ?? '').hostname.replace(/^www\./, '') || 'Link' } catch { return 'Link' }
    }
    default: return 'Card'
  }
}

/** Does the board actually hold this card? A comment can only be pinned to a
 *  card the client can see — an id from the address bar is not a card. */
export function findCanvasCard<T extends { id: string; kind: string }>(cards: readonly T[], cardId: string | null | undefined): T | null {
  if (!cardId) return null
  return cards.find(c => c.id === cardId && c.kind !== 'arrow') ?? null
}

/** Comments on one card, oldest first. */
export function commentsOnCard<T extends { card_id?: string | null; created_at: string }>(cardId: string, comments: readonly T[]): T[] {
  return comments.filter(c => c.card_id === cardId).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** How many comments sit on each card — the badge on the card reads this. */
export function countByCard<T extends { card_id?: string | null }>(comments: readonly T[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of comments) {
    if (!c.card_id) continue
    out[c.card_id] = (out[c.card_id] ?? 0) + 1
  }
  return out
}

/** "Golf Day — on: Hero reel image", or just the shoot's title. */
export function commentSubject(shootTitle: string, cardLabel: string | null | undefined): string {
  return cardLabel ? `${shootTitle} — on: ${cardLabel}` : shootTitle
}

/** The team's shoot page, opened on that card's thread when there is one. */
export function shootCommentPath(batchId: string, cardId: string | null | undefined): string {
  const base = `/dashboard/production/shoots/${encodeURIComponent(batchId)}`
  return cardId ? `${base}?card=${encodeURIComponent(cardId)}` : base
}

/** The client's portal shoot page, on the same card. */
export function portalShootCommentPath(token: string, batchId: string, cardId: string | null | undefined): string {
  const base = `/portal/${encodeURIComponent(token)}/shoot/${encodeURIComponent(batchId)}`
  return cardId ? `${base}?card=${encodeURIComponent(cardId)}` : base
}

/** The thread's own words for a pinned comment: "on: Hero reel image". */
export function onCardLine(cardLabel: string | null | undefined): string | null {
  return cardLabel ? `on: ${cardLabel}` : null
}

/** Client-side: how many comments to badge, from the same rows the thread
 *  shows. 0 draws an empty bubble — the invitation — rather than nothing. */
export function badgeLabel(n: number): string {
  if (n <= 0) return 'Leave a comment'
  return n === 1 ? '1 comment' : `${n} comments`
}
