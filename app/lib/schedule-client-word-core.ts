/**
 * WHERE THE CLIENT STANDS ON A POST, ON THE SCHEDULE'S PREVIEW (pure; tests/schedule-client-word-core.test.ts).
 *
 * WHY (the owner, 27 Nov 2026: "can we include post anyway or approved and scheduled or awaiting client or whatever
 * status we have from post approval in feed preview?" — and of the row of counts above it: "this needs to be
 * updated"). The Preview said only "Booked in" on a tile. Whether the client has approved it, is being waited for,
 * said no, or is not being asked at all was a thing you opened each post to find out.
 *
 * One word per post that has not gone out yet, from the two things already on its row: what the client said
 * (`reviewState`) and what the team chose for a post they have not answered (`ifNoAnswerOf`).
 */
import { ifNoAnswerOf, reviewState } from './one-portal-core'

export type ClientWord = 'waiting' | 'posts_anyway' | 'approved' | 'not_approved' | 'no_approval'

/** the order they are counted and offered in: what needs somebody first */
export const CLIENT_WORDS: readonly ClientWord[] = ['waiting', 'not_approved', 'posts_anyway', 'approved', 'no_approval']

export const CLIENT_WORD_LABEL: Record<ClientWord, string> = {
  waiting: 'Waiting for client',
  not_approved: 'Client: not approved',
  posts_anyway: 'Not reviewed — posts anyway',
  approved: 'Client approved',
  no_approval: 'No approval needed',
}

/** how a tile's mark is coloured: amber waits, red is a no, green is a yes, grey needs nobody */
export const CLIENT_WORD_TONE: Record<ClientWord, 'amber' | 'red' | 'green' | 'grey'> = {
  waiting: 'amber',
  not_approved: 'red',
  posts_anyway: 'grey',
  approved: 'green',
  no_approval: 'grey',
}

type Row = {
  stage: string
  client_review?: unknown
  review_asked?: unknown
  sent_version?: unknown
  if_no_answer?: unknown
}

/**
 * The client's standing on a post that is still to go out (Ready to post or Booked in); null for anything else — a
 * post that is out, cancelled or still a draft has nothing left for the client to say.
 *
 * A yes or a no is theirs and is shown whatever the team's setting. With no answer (or one asked for again on a
 * newer version), the setting decides: it waits for them, goes out anyway, or they are not asked.
 */
export function clientWord(row: Row): ClientWord | null {
  if (row.stage !== 'ready' && row.stage !== 'booked') return null
  const state = reviewState(row)
  if (state === 'approved') return 'approved'
  if (state === 'not_approved') return 'not_approved'
  const choice = ifNoAnswerOf(row)
  return choice === 'wait' ? 'waiting' : choice === 'none' ? 'no_approval' : 'posts_anyway'
}

/** how many posts stand at each word — every word is there, at 0 when none do */
export function clientWordCounts(rows: readonly Row[]): Record<ClientWord, number> {
  const out: Record<ClientWord, number> = { waiting: 0, not_approved: 0, posts_anyway: 0, approved: 0, no_approval: 0 }
  for (const r of rows) { const w = clientWord(r); if (w) out[w] += 1 }
  return out
}

/* ── the Preview, one account at a time ─────────────────────────────────────────────────────────────────────── */

/** the networks the Preview draws a feed for, in the order their buttons sit — the client portal's own four */
export const PREVIEW_NETWORKS = ['instagram', 'facebook', 'tiktok', 'linkedin'] as const
export type PreviewNetwork = (typeof PREVIEW_NETWORKS)[number]

type Account = { id: string; platform: string; active?: boolean | null }

/**
 * THE CLIENT'S ACCOUNTS THE PREVIEW CAN SHOW (the owner, 27 Nov 2026: "client portal feed has all the platforms but
 * here there is none … its only showing instagram"). Every connected account on the four networks, Instagram first.
 */
export function previewAccounts<T extends Account>(accounts: readonly T[]): T[] {
  return PREVIEW_NETWORKS.flatMap(n => accounts.filter(a => String(a.platform).toLowerCase() === n && a.active !== false))
}

/** Which account the Preview opens on: the one picked in the bar above when it has a feed, else the first. */
export function previewAccount<T extends Account>(accounts: readonly T[], pickedId: string | null | undefined, barId: string | null | undefined): T | null {
  const list = previewAccounts(accounts)
  return list.find(a => a.id === pickedId) ?? list.find(a => a.id === barId) ?? list[0] ?? null
}

/** how a network's feed is drawn: a grid of covers, or a column of posts with their words */
export function previewShape(network: string): 'grid' | 'tall-grid' | 'cards' {
  const n = network.toLowerCase()
  return n === 'instagram' ? 'grid' : n === 'tiktok' ? 'tall-grid' : 'cards'
}

type Slide = { url: string; type?: string | null }
type PostFiles = { slides: readonly Slide[]; per_channel?: unknown; caption?: string | null }

const own = (p: PostFiles, accountId: string) =>
  ((p.per_channel && typeof p.per_channel === 'object' ? (p.per_channel as Record<string, unknown>)[accountId] : null) ?? {}) as {
    slides?: readonly Slide[] | null; caption?: string | null; thumbnailUrl?: string; videoCoverImageUrl?: string
  }

/**
 * What ONE account leads a post with — the same rule the post window's Feed preview and the portal use
 * (`networkFeedPreview`): the cover chosen for that channel, else that channel's own first file, else the post's.
 */
export function previewCover(p: PostFiles, accountId: string): Slide | null {
  const o = own(p, accountId)
  const chosen = String(o.videoCoverImageUrl ?? o.thumbnailUrl ?? '').trim()
  if (chosen) return { url: chosen, type: 'image' }
  const slides = o.slides && o.slides.length ? o.slides : p.slides
  return slides[0] ?? null
}

/** the words that account posts: its own caption when it has one, else the post's */
export function previewCaption(p: PostFiles, accountId: string): string {
  return String(own(p, accountId).caption?.trim() || p.caption || '')
}
