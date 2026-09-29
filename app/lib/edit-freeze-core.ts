/**
 * WHAT THE CLIENT WAS GIVEN, FROZEN — the edit's half of the posting rebuild
 * (29 Sep 2026; SPEC §2.6, audit P1). Pure: no I/O.
 *
 * The audit's P1: the portal's edit page read the card's LIVE files
 * (`liveFilesAt(row, clientSeenRound(row))`, portal-thread.ts), filtered only by
 * round number. A file added to the card after it went to the client — same
 * round, or a replacement — appeared on the client's page, and the client
 * approved or commented on files nobody had sent them. What the email invited
 * them to review could not be reconstructed afterwards (live: 411da9a1, 23 Sep).
 *
 * The fix is the same one the posts get (post_versions): at the move to With
 * client, `performTransition` writes `content_items.client_frozen` in the SAME
 * claim as the move, from the row the claim read. The portal's edit page reads
 * `client_frozen.files` and nothing else. Only the next move to With client
 * writes a new one.
 */

import { assetIdOf, liveFilesAt, type FinalFile } from './final-files-core'
import { roundOf } from './edit-round-core'

export type FrozenFile = {
  /** the file's own id */
  id: string
  /** the asset this file is a version of (the first upload's id) */
  asset_id: string
  /** the card round it was handed in with */
  version: number
  url: string
  name: string
  mime: string
}

export type ClientFrozen = {
  /** the card's round that went to the client */
  round: number
  /** when it was frozen: the moment of the move */
  at: string
  /** exactly the files the client was given, in the card's order */
  files: FrozenFile[]
  /** a link card's link, when the link is the finished piece (not only the folder to work from) */
  link: { url: string; kind: string | null } | null
}

type CardShape = {
  final_files?: unknown
  edit_round?: unknown
  link_url?: string | null
  link_kind?: string | null
  link_final?: boolean | null
  raw_assets_url?: string | null
}

/** A link is the piece unless it is only the posting job's folder (the same rule performTransition's evidence check uses). */
function finishedLink(card: CardShape): { url: string; kind: string | null } | null {
  const url = typeof card.link_url === 'string' ? card.link_url.trim() : ''
  if (!url) return null
  const folderOnly = card.link_final !== true && url === (card.raw_assets_url ?? null)
  return folderOnly ? null : { url, kind: typeof card.link_kind === 'string' && card.link_kind ? card.link_kind : null }
}

/**
 * The frozen copy for a card going to the client NOW. `card` must be the row
 * the claim read (not an earlier snapshot), so the freeze and the move see the
 * same files. The round is the card's current round — the same number
 * `client_round` is stamped with in that write.
 */
export function clientFrozenFor(card: CardShape, at: string): ClientFrozen {
  const round = roundOf(card as { edit_round?: unknown })
  const files: FrozenFile[] = liveFilesAt(card, round).map((f: FinalFile) => ({
    id: f.id,
    asset_id: assetIdOf(f),
    version: f.version,
    url: f.url,
    name: f.name,
    mime: f.mime,
  }))
  return { round, at, files, link: finishedLink(card) }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [])

/**
 * Read `content_items.client_frozen` back, or null when the card has never been
 * frozen (it went to the client before 29 Sep 2026, or never went). The
 * Realtime Database stores arrays as keyed objects and drops empty ones, so
 * both shapes are read, and a file without an https url is dropped.
 */
export function readClientFrozen(v: unknown): ClientFrozen | null {
  if (!isObj(v)) return null
  const round = typeof v.round === 'number' && Number.isFinite(v.round) ? v.round : null
  const at = typeof v.at === 'string' ? v.at : null
  if (round == null || !at) return null
  const files = list(v.files)
    .filter((f): f is Record<string, unknown> => isObj(f) && typeof f.id === 'string' && typeof f.url === 'string' && /^https:\/\//.test(f.url))
    .map(f => ({
      id: String(f.id),
      asset_id: typeof f.asset_id === 'string' && f.asset_id ? f.asset_id : String(f.id),
      version: typeof f.version === 'number' ? f.version : round,
      url: String(f.url),
      name: typeof f.name === 'string' && f.name ? f.name : 'A file',
      mime: typeof f.mime === 'string' ? f.mime : '',
    }))
  const link = isObj(v.link) && typeof v.link.url === 'string' && v.link.url
    ? { url: v.link.url, kind: typeof v.link.kind === 'string' ? v.link.kind : null }
    : null
  return { round, at, files, link }
}

/**
 * The files the client may see for this card: the frozen ones when the card
 * was frozen for the round they were last given, else null — the caller (the
 * portal, package P6) then shows "Sent before versions were kept" rather than
 * guessing from the live files.
 */
export function frozenFilesForClient(card: { client_frozen?: unknown; client_round?: unknown }): FrozenFile[] | null {
  const frozen = readClientFrozen(card.client_frozen)
  if (!frozen) return null
  const seen = typeof card.client_round === 'number' ? card.client_round : null
  if (seen != null && seen !== frozen.round) return null
  return frozen.files
}
