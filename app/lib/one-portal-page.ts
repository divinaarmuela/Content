import 'server-only'
import { table } from '@/lib/db'
import type { Client, ContentItem } from '@/lib/db-types'
import { portalOwnerByToken } from './portal-owner'
import { getPortalData, type PortalCard, type PortalData } from './portal-data'
import { onePortal, workTab, type PortalTab } from './one-portal-core'
import type { PortalScope } from './portal-owner-core'

/**
 * THE ONE PORTAL'S PAGE DATA (docs/ONE_PORTAL_SPEC.md §3). Built on today's portal payload (`getPortalData`, which
 * already keeps a person's link to their own work), split into the tabs. Null when the link is unknown or the
 * client is not on the one portal — the page then answers 404, so a guessed address shows nothing.
 */
export type OnePortalPage = {
  token: string
  client: Pick<Client, 'id' | 'name'>
  scope: PortalScope
  data: PortalData
  shoots: PortalCard[]
  editing: PortalCard[]
  designing: PortalCard[]
  /** how many things wait on the client in each tab — the tab's badge */
  waiting: Record<PortalTab, number>
}

/** A card the client is asked to answer now: a plan or piece with Approve on it, or an edit with the client. */
export const waitsOnClient = (c: PortalCard) => c.actions.approve === true || c.status === 'client_review'

/**
 * The pieces the client may see in Editing / Designing: an edit that has reached them stays open the whole way
 * (portalHasWork — the same rule as its old link), and any other piece once it is theirs to review, approved or
 * posted. Never one still being made or at the quality check (the portal's rule since 14 Sep 2026).
 */
export const workShown = (c: PortalCard) =>
  c.kind === 'work' && (c.editing === true || c.column === 'your_review' || c.column === 'approved' || c.column === 'posted')

/** Did the client approve the newest version they were given? (accepted_round, stamped by their approval) */
export function clientApprovedLatest(item: { accepted_round?: unknown; client_round?: unknown } | null | undefined): boolean {
  const accepted = Number(item?.accepted_round), given = Number(item?.client_round)
  return Number.isInteger(accepted) && Number.isInteger(given) && given >= 1 && accepted >= given
}

/** The first picture (or playable video) of the version the client was given, for the tile. */
export function clientCover(item: { client_frozen?: unknown } | null | undefined): string | null {
  const files = (item?.client_frozen as { files?: { url?: unknown; mime?: unknown; name?: unknown }[] } | null)?.files ?? []
  const pic = files.find(f => String(f.mime ?? '').startsWith('image/') && typeof f.url === 'string')
  if (pic) return String(pic.url)
  const vid = files.find(f => /\.(mp4|webm)(\?|$)/i.test(String(f.url ?? f.name ?? '')) && typeof f.url === 'string')
  return vid ? String(vid.url) : null
}

function withClientFace(card: PortalCard, item: ContentItem | undefined): PortalCard {
  const raw = item as unknown as Record<string, unknown> | undefined
  const approved = clientApprovedLatest(raw as never) && card.status !== 'client_review'
  return {
    ...card,
    ...(approved ? { line: 'Approved — the team is scheduling it.', column: 'approved' as const } : {}),
    preview_url: card.preview_url ?? clientCover(raw as never),
  }
}

export async function loadOnePortal(rawToken: string): Promise<OnePortalPage | null> {
  const token = decodeURIComponent(rawToken).split('--').pop() ?? rawToken
  const owner = await portalOwnerByToken(token)
  if (!owner) return null
  const client = await table<Client>('clients').get(owner.client.id).catch(() => null)
  if (!client || !onePortal(client)) return null
  const data = await getPortalData(client.id, owner.scope)
  if (!data) return null

  const shoots = data.cards.filter(c => c.kind === 'shoot')
  const work = data.cards.filter(workShown)
  // which tab a piece belongs in: its work kind (graphics → Designing), read here so the live loader is untouched
  const ids = new Set(work.map(c => c.id))
  const [items, kinds] = await Promise.all([
    ids.size ? table<ContentItem>('content_items').list({ where: r => ids.has(r.id) }) : Promise.resolve([] as ContentItem[]),
    table<{ id: string; slug: string }>('work_kinds').list().catch(() => [] as { id: string; slug: string }[]),
  ])
  const slugOf = new Map(kinds.map(k => [k.id, k.slug]))
  const tabOf = new Map(items.map(i => [i.id, workTab(i.work_kind_id ? slugOf.get(String(i.work_kind_id)) : null)]))
  // the piece as the client knows it (1 Oct 2026, the walk: an approved design handed to the scheduler read
  // "Being made now" — the hand-over moves the CARD back to draft for posting, the client's answer stands)
  const itemById = new Map(items.map(i => [i.id, i]))
  const shown = work.map(c => withClientFace(c, itemById.get(c.id)))
  const editing = shown.filter(c => (tabOf.get(c.id) ?? 'editing') === 'editing')
  const designing = shown.filter(c => tabOf.get(c.id) === 'designing')

  return {
    token,
    client: { id: client.id, name: client.name },
    scope: owner.scope,
    data,
    shoots,
    editing,
    designing,
    waiting: {
      shoot: shoots.filter(waitsOnClient).length,
      editing: editing.filter(waitsOnClient).length,
      designing: designing.filter(waitsOnClient).length,
      scheduling: 0,
    },
  }
}
